// Runs in a memory-limited child process. No network, code execution, or writes.
const {unzipSync}=require('fflate');
const {XMLParser}=require('fast-xml-parser');
const MAX_TEXT=750000, MAX_EXPANDED=25*1024*1024;
const xml=new XMLParser({ignoreAttributes:false,processEntities:false,trimValues:false});
function decodeXml(text){return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,(_,code)=>{
  const basic={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(basic[code.toLowerCase()])return basic[code.toLowerCase()];
  const value=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);
  return value>0 && value<=0x10ffff && !(value>=0xd800 && value<=0xdfff)?String.fromCodePoint(value):'';
});}
function flatten(node) {
  if(typeof node==='string' || typeof node==='number') return String(node);
  if(Array.isArray(node)) return node.map(flatten).filter(Boolean).join(' ');
  if(!node || typeof node!=='object') return '';
  return Object.entries(node).filter(([key])=>key==='#text' || !key.startsWith('@_')).map(([,v])=>flatten(v)).filter(Boolean).join(' ');
}
function unzipParts(buffer,needed) {
  let count=0,total=0;
  return unzipSync(buffer,{filter:entry=>{
    if(++count>2000 || (total+=entry.originalSize)>MAX_EXPANDED || entry.originalSize>MAX_EXPANDED) throw Error('Archive expands beyond the safe extraction limit.');
    return needed(entry.name);
  }});
}
function docx(buffer) {
  const files=unzipParts(buffer,name=>name==='word/document.xml');
  if(!files['word/document.xml']) throw Error('Word document text was not found.');
  const document=xml.parse(Buffer.from(files['word/document.xml']).toString('utf8'));
  const body=document['w:document']?.['w:body'];
  function lines(node) {
    if(!node || typeof node!=='object') return [];
    if(Array.isArray(node)) return node.flatMap(lines);
    const rows=[];
    for(const [key,value] of Object.entries(node)) {
      if(key==='w:p') { for(const para of Array.isArray(value)?value:[value]) rows.push(flatten(para)); }
      else if(key==='w:tbl') rows.push(...lines(value));
      else if(key==='w:tr' || key==='w:tc') rows.push(...lines(value));
    }
    return rows;
  }
  return decodeXml(lines(body).filter(Boolean).join('\n'));
}
function xlsx(buffer) {
  const files=unzipParts(buffer,name=>name==='xl/sharedStrings.xml' || name==='xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const parseFile=name=>xml.parse(Buffer.from(files[name]).toString('utf8'));
  const shared=files['xl/sharedStrings.xml'] ? ((items=>Array.isArray(items)?items:[items])(parseFile('xl/sharedStrings.xml').sst?.si || [])).map(flatten) : [];
  const wb=files['xl/workbook.xml'] ? parseFile('xl/workbook.xml') : null;
  const sheetNames=((s=>Array.isArray(s)?s:s?[s]:[])(wb?.workbook?.sheets?.sheet)).map(s=>s['@_name']);
  return decodeXml(Object.keys(files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)?.[0])-Number(b.match(/\d+/)?.[0])).map((name,index)=>{
    const sheet=parseFile(name).worksheet?.sheetData?.row || [];
    const rows=(Array.isArray(sheet)?sheet:[sheet]).map(row=>{
      const cells=Array.isArray(row.c)?row.c:row.c?[row.c]:[];
      return cells.map(cell=>{
        const value=cell['@_t']==='s'?shared[Number(cell.v)] : cell['@_t']==='inlineStr'?flatten(cell.is) : cell.v;
        return `${cell['@_r'] || ''}: ${flatten(value)}`;
      }).filter(x=>!x.endsWith(': ')).join(' | ');
    }).filter(Boolean);
    return `Sheet: ${sheetNames[index] || index+1}\n${rows.join('\n')}`;
  }).join('\n\n'));
}
async function pdf(buffer) {
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document=await pdfjs.getDocument({data:new Uint8Array(buffer),useSystemFonts:true,disableFontFace:true,isEvalSupported:false}).promise;
  if(document.numPages>300) throw Error('PDF has too many pages.');
  const pages=[];
  for(let page=1;page<=document.numPages;page++) {
    const content=await (await document.getPage(page)).getTextContent();
    pages.push(`Page ${page}\n${content.items.map(item=>item.str).join(' ')}`);
    if(pages.join('').length>MAX_TEXT) throw Error('Extracted text exceeds the 750,000 character limit.');
  }
  await document.destroy();
  return pages.join('\n\n');
}
async function extract(buffer,extension) {
  let text;
  if(['txt','md','csv'].includes(extension)) text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  else if(extension==='docx') text=docx(buffer);
  else if(extension==='xlsx') text=xlsx(buffer);
  else if(extension==='pdf') text=await pdf(buffer);
  else throw Error('Unsupported file type.');
  text=text.replace(/\u0000/g,'').trim();
  if(!text) throw Error('No selectable text was found. Scanned PDFs require OCR before uploading.');
  if(text.length>MAX_TEXT) throw Error('Extracted text exceeds the 750,000 character limit.');
  return text;
}
let parts=[],size=0;
process.stdin.on('data',chunk=>{size+=chunk.length;if(size>10*1024*1024){process.stderr.write('Input exceeds 10 MB.');process.exit(1);}parts.push(chunk);});
process.stdin.on('end',async()=>{try{process.stdout.write(await extract(Buffer.concat(parts),process.argv[2]));}catch(error){process.stderr.write(String(error.message).slice(0,400));process.exitCode=1;}});
