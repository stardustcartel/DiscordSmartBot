let fileGuild='',fileSavedChannels=[],fileChannelsSelected=new Set(),fileChannelsList=[],fileFolders=[],fileSavedFolders=[],fileFolderStack=[{id:'root',name:'My Drive'}],fileBusy=false,fileLoad=0,fileConfigured=false;
const fileEqual=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
let fileFolderValidating=false,fileFolderRequest=0;
function fileFolderError(message='') {
  $('#file-folder-error').textContent=message;$('#file-folder-error').hidden=!message;
  $('#file-folder-url').setAttribute('aria-invalid',String(Boolean(message)));
}
function fileFolderInputState() {
  $('#file-folder-add').disabled=fileBusy || fileFolderValidating || !$('#file-folder-url').value.trim();
  $('#file-folder-add').textContent=fileFolderValidating?'Checking folder…':'Add folder';
  $('#file-folder-url').disabled=fileFolderValidating;
}
async function addFileFolder() {
  const value=$('#file-folder-url').value.trim(),guildId=selected;
  if(!value || !guildId || fileBusy || fileFolderValidating)return;
  fileFolderError();let id=value;
  try {
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
      const url=new URL(value);
      if(url.protocol!=='https:' || !['drive.google.com','docs.google.com'].includes(url.hostname) || url.username || url.password || url.port)throw Error();
      id=url.pathname.match(/^\/(?:drive\/(?:u\/\d+\/)?)?folders\/([A-Za-z0-9_-]{1,100})\/?$/)?.[1];
      if(!id)throw Error();
    }
  } catch {fileFolderError('Enter a valid Google Drive folder link or folder ID. Links to individual files or other websites cannot be added.');return;}
  if(fileFolders.some(f=>f.id===id)){fileFolderError('This folder is already selected.');return;}
  if(fileFolders.length>=10){fileFolderError('Choose up to 10 folders. Remove a selected folder before adding another.');return;}
  const request=++fileFolderRequest;fileFolderValidating=true;fileFolderInputState();fileFolderSelection();
  try {
    const result=await api(`/api/guild/${guildId}/files`,{method:'POST',body:JSON.stringify({action:'validateFolder',folderId:id})});
    if(request!==fileFolderRequest || guildId!==selected)return;
    fileFolders.push(result.folder);$('#file-folder-url').value='';
  } catch(error) {if(request===fileFolderRequest && guildId===selected)fileFolderError(error.message || 'This folder could not be verified. Check the link and connected account’s access.');}
  finally {if(request===fileFolderRequest){fileFolderValidating=false;fileFolderInputState();fileFolderSelection();}}
}
function setKnowledgeLock(locked) {
  const group=$('#knowledge-tab');
  group.disabled=locked;group.classList.toggle('locked',locked);
  group.querySelector('.lock-icon').hidden=!locked;
  group.querySelector('.subtab-copy small').textContent=locked?'Add an AI key first':'Discord, Patreon & files';
  for(const id of ['knowledge-discord-tab','knowledge-patreon-tab','knowledge-files-tab']) {
    const button=$('#'+id);button.disabled=locked;button.classList.toggle('locked',locked);
    if(locked)button.hidden=true;
  }
  if(locked)group.setAttribute('aria-expanded','false');
}
function updateFileUploadSelection() {
  const files=$('#file-upload-input').files;
  $('#file-upload-label').textContent=!files.length?'Choose files':files.length===1?files[0].name:`${files.length} files selected`;
  $('#file-upload-clear').hidden=!files.length;
  $('#file-upload-clear').disabled=fileBusy;
  $('#file-upload-save').disabled=!fileConfigured || !files.length || fileBusy;
}
function closeFileChannelMenu(){const list=$('#file-channel-options');list.hidden=true;$('#file-channel-trigger').setAttribute('aria-expanded','false');$('#file-channel-trigger').classList.remove('open');}
function fileSelectionButtons(){
  $('#file-channel-label').textContent=fileChannelsSelected.size?`${fileChannelsSelected.size} channels selected`:'All bot response channels';
  const menu=$('#file-channel-options');menu.replaceChildren();
  for(const channel of fileChannelsList){const button=document.createElement('button');button.type='button';button.className='select-option multi-select-option';button.setAttribute('role','option');button.setAttribute('aria-selected',String(fileChannelsSelected.has(channel.id)));
    button.textContent=`${fileChannelsSelected.has(channel.id)?'✓ ':'  '}# ${channel.name}${channel.type===15?' · Forum':''}`;
    button.onclick=event=>{event.stopPropagation();if(fileBusy)return;fileChannelsSelected.has(channel.id)?fileChannelsSelected.delete(channel.id):fileChannelsSelected.add(channel.id);fileSelectionButtons();};menu.append(button);}
  $('#file-channel-save').disabled=fileBusy || fileGuild!==selected || fileEqual([...fileChannelsSelected],fileSavedChannels);
}
function fileFolderSelection(){
  $('#file-folder-selection').textContent=fileFolders.length?`${fileFolders.length} folder${fileFolders.length===1?'':'s'} selected`:'No folders selected';
  const list=$('#file-selected-folders');list.replaceChildren();
  for(const folder of fileFolders) {
    const row=document.createElement('div');row.className='file-selected-folder';
    const name=document.createElement('span');name.textContent=folder.name;
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${folder.name}`);remove.disabled=fileBusy || fileFolderValidating;
    remove.onclick=()=>{if(fileBusy || fileFolderValidating)return;fileFolders=fileFolders.filter(f=>f.id!==folder.id);fileFolderError();fileFolderSelection();};
    row.append(name,remove);list.append(row);
  }
  document.querySelectorAll('#file-folder-list [data-folder-id]').forEach(button=>{
    const chosen=fileFolders.some(f=>f.id===button.dataset.folderId);button.setAttribute('aria-selected',String(chosen));
    button.textContent=`${chosen?'✓ ':'  '}${button.dataset.folderName}`;button.disabled=fileBusy || fileFolderValidating;
  });
  $('#file-folder-save').disabled=fileBusy || fileFolderValidating || fileGuild!==selected || JSON.stringify(fileFolders.map(f=>f.id).sort())===JSON.stringify(fileSavedFolders.map(f=>f.id).sort());
  fileFolderInputState();
}
async function browseFilesFolder(){
  const guildId=selected,parent=fileFolderStack.at(-1);if(!guildId)return;
  $('#file-folder-list').textContent='Loading folders…';$('#file-folder-path').textContent=fileFolderStack.map(f=>f.name).join(' / ');
  const data=await api(`/api/guild/${guildId}/files`,{method:'POST',body:JSON.stringify({action:'listFolders',parent:parent.id})});
  if(guildId!==selected || parent!==fileFolderStack.at(-1))return;
  const list=$('#file-folder-list');list.replaceChildren();
  for(const folder of data.folders){
    const row=document.createElement('div');row.className='file-actions';
    const choose=document.createElement('button');choose.type='button';choose.className='select-option';choose.setAttribute('role','option');
    choose.dataset.folderId=folder.id;choose.dataset.folderName=folder.name;
    choose.textContent=`${fileFolders.some(f=>f.id===folder.id)?'✓ ':'  '} ${folder.name}`;
    choose.onclick=()=>{if(fileBusy || fileFolderValidating)return;if(fileFolders.some(f=>f.id===folder.id))fileFolders=fileFolders.filter(f=>f.id!==folder.id);else if(fileFolders.length<10)fileFolders.push(folder);else {fileFolderError('Choose up to 10 folders. Remove a selected folder before adding another.');return;}fileFolderError();fileFolderSelection();};
    const open=document.createElement('button');open.type='button';open.textContent='Open';open.setAttribute('aria-label',`Open ${folder.name}`);open.onclick=()=>{fileFolderStack.push(folder);browseFilesFolder().catch(e=>toast(e.message));};
    row.append(choose,open);list.append(row);
  }
  if(!data.folders.length)list.textContent='No folders here.';
  if(data.more){const hint=document.createElement('p');hint.className='field-help';hint.textContent='Showing the first 100 folders. Narrow your selection by opening a folder.';list.append(hint);}
  $('#file-folder-up').disabled=fileFolderStack.length<=1;
  fileFolderSelection();
}
function renderFileList(data){
  const list=$('#file-list');list.replaceChildren();
  const statuses=data.status || {},ready=statuses.ready||0;
  const totalSections=data.files.reduce((n,f)=>n+(f.status?.sections || 0),0),semantic=data.files.reduce((n,f)=>n+(f.status?.semanticReady || 0),0);
  $('#file-summary').textContent=`${data.files.length} document${data.files.length===1?'':'s'} cataloged · ${ready} ready for answers · ${semantic} of ${totalSections} sections ready for semantic search · ${(statuses.queued||0)+(statuses.saving||0)} awaiting indexing · ${statuses.error||0} need attention.`;
  for(const file of data.files){
    const article=document.createElement('article'),title=document.createElement('h4'),status=document.createElement('small');
    title.textContent=`${file.name} · ${file.kind==='google'?'Google Drive':'Uploaded'}`;
    status.textContent=`${file.state} · ${(file.size/1024).toFixed(1)} KB · saved ${new Date(file.createdAt).toLocaleString()} · SHA-256 ${file.sha256}`;
    article.append(title,status);
    const location=document.createElement('p');location.className='field-help';location.textContent=`Storage: ${file.objectKey} · revision ${file.revision}${file.status?.localPath?' · Bot copy: '+file.status.localPath:''}`;article.append(location);
    if(file.status?.warning){const warning=document.createElement('p');warning.className='field-help';warning.textContent=file.status.warning;article.append(warning);}
    const desc=document.createElement('textarea');desc.maxLength=2000;desc.value=file.description || '';desc.setAttribute('aria-label',`Description for ${file.name}`);article.append(desc);
    const actions=document.createElement('div');actions.className='file-actions';
    const link=(label,view)=>{const a=document.createElement('a');a.textContent=label;a.href=`/api/guild/${selected}/files/${encodeURIComponent(file.id)}${view?'?view=text':''}`;actions.append(a);};
    link('Download original',false);if(file.state==='ready')link('Download extracted text',true);
    const save=document.createElement('button');save.type='button';save.textContent='Save description';save.disabled=true;desc.oninput=()=>save.disabled=desc.value===file.description || fileBusy;
    save.onclick=()=>fileAction('description',{id:file.id,description:desc.value});actions.append(save);
    if(file.state==='error'){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry indexing';retry.onclick=()=>fileAction('retry',{id:file.id});actions.append(retry);}
    const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.onclick=()=>{confirmBox.hidden=false;remove.disabled=true;};actions.append(remove);
    const confirmBox=document.createElement('div');confirmBox.hidden=true;confirmBox.className='file-actions';confirmBox.append('Remove this document and its indexed text? ');
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{confirmBox.hidden=true;remove.disabled=false;};
    const accept=document.createElement('button');accept.type='button';accept.textContent='Delete document';accept.onclick=()=>fileAction('delete',{id:file.id});confirmBox.append(cancel,accept);
    article.append(actions,confirmBox);list.append(article);
  }
  if(!data.files.length)list.textContent='No documents yet. Upload files or select a Google Drive folder.';
}
async function loadFiles(){
  const guildId=selected;if(!guildId)return;const request=++fileLoad;
  const [data,channels]=await Promise.all([api(`/api/guild/${guildId}/files`),api(`/api/guild/${guildId}/knowledge`).then(x=>x.channels).catch(()=>[])]);
  if(guildId!==selected || request!==fileLoad)return;
  const changed=fileGuild!==guildId;fileGuild=guildId;
  fileConfigured=data.configured;
  if(changed){fileChannelsSelected=new Set(data.channelIds);fileFolders=[...(data.google.folders||[])];fileFolderStack=[{id:'root',name:'My Drive'}];closeFileChannelMenu();fileFolderRequest++;fileFolderValidating=false;$('#file-folder-url').value='';fileFolderError();}
  fileSavedChannels=data.channelIds;fileSavedFolders=data.google.folders || [];
  fileChannelsList=channels;for(const id of fileChannelsSelected)if(!fileChannelsList.some(c=>c.id===id))fileChannelsList.push({id,name:'Unavailable channel'});
  fileSelectionButtons();fileFolderSelection();
  $('#file-google-connect').hidden=data.google.connected;$('#file-google-connect').disabled=!data.googleConfigured || fileBusy;
  $('#file-upload-setup').hidden=data.configured;
  $('#file-upload-input').disabled=!data.configured;
  updateFileUploadSelection();
  $('#file-google-setup').hidden=data.googleConfigured && data.configured;
  $('#file-google-connected').hidden=!data.google.connected;
  $('#file-google-name').textContent=(data.google.name || '')+(data.google.email?` (${data.google.email})`:'');
  $('#file-google-sync-status').textContent=data.google.sync?.warning || (data.google.sync?.scan?'Google Drive scan in progress.':data.google.sync?.checkedAt?`Last scan: ${new Date(data.google.sync.checkedAt).toLocaleString()}`:'Choose folders to begin syncing.');
  $('#file-events-download').href=`/api/guild/${guildId}/files?download=events`;
  renderFileList(data);
  if(data.google.connected && changed)browseFilesFolder().catch(e=>toast(e.message));
}
async function fileAction(action,extra={}){
  if(fileBusy || fileFolderValidating || !selected)return;const guildId=selected;fileBusy=true;fileFolderSelection();
  try{const result=await api(`/api/guild/${guildId}/files`,{method:'POST',body:JSON.stringify({action,...extra})});if(guildId!==selected)return;
    if(action==='connect'){location.assign(result.url);return;}
    if(action==='visibility')closeFileChannelMenu();
    if(action==='folders'){fileFolders=result.folders || fileFolders;fileFolderSelection();}
    if(action==='disconnect'){$('#file-google-confirm').hidden=true;fileFolderStack=[{id:'root',name:'My Drive'}];fileFolders=[];fileSavedFolders=[];fileFolderError();}
    toast(action==='sync'?'Google Drive sync requested.':action==='delete'?'Document deleted.':action==='folders'?'Google Drive folders saved.':'Saved.');
  }catch(error){if(action==='folders')fileFolderError(error.message);toast(error.message);}finally{fileBusy=false;fileFolderSelection();await loadFiles().catch(()=>{});}
}
function setupFiles(){
  const subtab=document.createElement('button');subtab.className='subtab side-subtab knowledge-source-subtab';subtab.id='knowledge-files-tab';subtab.dataset.tab='files';subtab.textContent='Files & Google Drive';subtab.hidden=true;
  $('#knowledge-patreon-tab').after(subtab);$('#knowledge-tab').setAttribute('aria-controls','knowledge-discord-tab knowledge-patreon-tab knowledge-files-tab');
  $('#knowledge-tab .subtab-copy small').textContent='Discord, Patreon & files';
  setKnowledgeLock(true);
  subtab.onclick=()=>showTab('files');
  $('#file-channel-trigger').onclick=()=>{const open=$('#file-channel-options').hidden;closeFileChannelMenu();$('#file-channel-options').hidden=!open;$('#file-channel-trigger').classList.toggle('open',open);$('#file-channel-trigger').setAttribute('aria-expanded',String(open));};
  document.addEventListener('click',event=>{if(!event.target.closest('#file-channel-select'))closeFileChannelMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeFileChannelMenu();});
  $('#file-channel-save').onclick=()=>fileAction('visibility',{channelIds:[...fileChannelsSelected]});
  $('#file-google-connect').onclick=()=>fileAction('connect');$('#file-google-reconnect').onclick=()=>fileAction('connect');
  $('#file-google-sync').onclick=()=>fileAction('sync');
  $('#file-google-disconnect').onclick=()=>{$('#file-google-confirm').hidden=false;};
  $('#file-google-cancel').onclick=()=>{$('#file-google-confirm').hidden=true;};
  $('#file-google-confirm-delete').onclick=()=>fileAction('disconnect');
  $('#file-folder-up').onclick=()=>{if(fileFolderStack.length>1)fileFolderStack.pop();browseFilesFolder().catch(e=>toast(e.message));};
  $('#file-folder-add').onclick=addFileFolder;
  $('#file-folder-url').oninput=()=>{fileFolderError();fileFolderInputState();};
  $('#file-folder-url').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addFileFolder();}};
  fileFolderInputState();
  $('#file-folder-save').onclick=()=>fileAction('folders',{folderIds:fileFolders.map(f=>f.id)});
  $('#file-upload-input').onchange=updateFileUploadSelection;
  $('#file-upload-clear').onclick=event=>{event.preventDefault();event.stopPropagation();if(fileBusy)return;$('#file-upload-input').value='';updateFileUploadSelection();};
  $('#file-upload-form').onsubmit=async event=>{event.preventDefault();const guildId=selected,files=[...$('#file-upload-input').files];if(!guildId || !files.length || fileBusy)return;
    fileBusy=true;updateFileUploadSelection();$('#file-upload-input').disabled=true;
    try{for(const file of files){const form=new FormData();form.append('file',file);form.append('description',$('#file-upload-description').value);
      const response=await fetch(`/api/guild/${guildId}/files`,{method:'POST',body:form});const data=await response.json();if(!response.ok)throw Error(`${file.name}: ${data.error || 'Upload failed.'}`);}
      if(guildId===selected){$('#file-upload-form').reset();toast(`${files.length} file${files.length===1?'':'s'} uploaded. Indexing will begin shortly.`);}
    }catch(error){toast(error.message);}finally{fileBusy=false;$('#file-upload-input').disabled=!fileConfigured;updateFileUploadSelection();await loadFiles().catch(()=>{});}
  };
  setInterval(()=>{if(!document.hidden && $('#files').classList.contains('active') && !$('#workspace').hidden)loadFiles().catch(()=>{});},15000);
}
