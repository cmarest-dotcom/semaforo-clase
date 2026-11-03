import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth,signInWithEmailAndPassword,onAuthStateChanged,signOut,setPersistence,browserLocalPersistence,browserSessionPersistence} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {getDatabase,ref,onValue,update,get} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

const $=s=>document.querySelector(s);
const content=$('#content'), connection=$('#connection');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search), boardMode=params.get('mode')==='board', liveMode=params.get('mode')==='live';
const cfg=window.SEMAFORO_FIREBASE||{};
const configured=cfg.apiKey&&!cfg.apiKey.includes('REEMPLAZAR')&&cfg.databaseURL&&!cfg.databaseURL.includes('REEMPLAZAR');
let app,auth,db,user=null,classes={},classId=null,students={},page='plan',editSeats=false,board=null,unsubClasses=()=>{},unsubStudents=()=>{},unsubBoard=()=>{},busy=false;
const stateName={green:'Verde',yellow:'Amarillo',red:'Rojo'};
const genId=()=>{const b=new Uint8Array(12);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,'0')).join('')};
const sorted=()=>Object.entries(students).map(([id,v])=>({id,...v})).sort((a,b)=>a.name.localeCompare(b.name,'es'));
const current=()=>classes[classId]||null;
const counts=()=>{const a={green:0,yellow:0,red:0,total:0};for(const v of Object.values(students)){const s=['green','yellow','red'].includes(v.status)?v.status:'green';a[s]++;a.total++}return a};
const showMessage=(txt,isError=false)=>{let el=$('#notice');if(!el){el=document.createElement('div');el.id='notice';content.prepend(el)}el.className='message'+(isError?' error':'');el.textContent=txt};
const statusBadge=s=>`<span class="status ${s}">${stateName[s]||'Verde'}</span>`;
const countCards=o=>`<div class="summary"><div class="stat green"><strong>${o.green||0}</strong><span>Verde</span></div><div class="stat yellow"><strong>${o.yellow||0}</strong><span>Amarillo</span></div><div class="stat red"><strong>${o.red||0}</strong><span>Rojo</span></div></div>`;
const setConnection=t=>connection.textContent=t;

if(!configured){setConnection('Falta configuración');content.innerHTML=`<section class="panel"><h1>Configuración pendiente</h1><p>Esta aplicación todavía no está conectada a Firebase. Abre <code>public/config.js</code> en tu ordenador y sustituye los campos de ejemplo por los datos de tu proyecto.</p><p>Consulta el archivo <b>INSTRUCCIONES.md</b> incluido en el paquete.</p></section>`}
else {
 try {app=initializeApp(cfg);db=getDatabase(app);auth=getAuth(app);
 if(liveMode) setupLive(); else if(boardMode) setupBoard(); else setupTeacher();}
 catch(e){setConnection('Error de configuración');content.innerHTML=`<section class="panel"><h1>No se pudo iniciar Firebase</h1><p>${esc(e.message)}</p></section>`}
}

// Una dirección fija por profesor: solo transmite datos anónimos de proyección.
function setupLive(){
 const uid=params.get('teacher');
 if(!uid||!/^[-\w]+$/.test(uid)){content.innerHTML='<section class="panel">Enlace SMART incompleto. Cópialo desde el panel del profesor.</section>';return}
 content.className='board';setConnection('Conectando…');
 unsubBoard=onValue(ref(db,`live/${uid}`),snap=>{board=snap.val();setConnection('Sincronizado');drawLive()},err=>{setConnection('Error de lectura');content.innerHTML=`<section class="panel error">No se puede leer la proyección: ${esc(err.message)}</section>`});
}
function drawLive(){
 if(!board||!board.visible){content.innerHTML='<section class="panel"><h1>Semáforo de aula</h1><p class="empty">Estamos trabajando · El profesor mostrará los avisos cuando corresponda.</p></section>';return}
 if(board.view==='plan'){
  const rows=Math.max(1,Math.min(9,Number(board.rows)||5)),cols=Math.max(1,Math.min(9,Number(board.cols)||5));
  let seats='<div class="front">PIZARRA / PROFESOR</div><div class="projection-seats" style="grid-template-columns:repeat('+cols+',minmax(0,1fr))">';
  for(let i=0;i<rows*cols;i++){const st=board.seats?.['s'+i];const safe=['green','yellow','red'].includes(st)?st:'';seats+=`<div class="projection-seat ${safe||'empty-seat'}" aria-label="Puesto ${i+1}${safe?' ocupado':''}">${i+1}</div>`}
  seats+='</div>';
  content.innerHTML=`<h1>Distribución del aula</h1>${seats}<p class="note">Los números indican los pupitres, sin identificar a ningún alumno.</p>`;
 }else{content.innerHTML=`<h1>Semáforo de aula</h1>${countCards(board)}<p class="note">Podemos mejorar nuestra participación y respetar los turnos de palabra.</p>`}
}
function livePayload(id,group,people,visible=false,view='summary'){
 const a=summaryFrom(people,visible),seats={};
 if(visible&&view==='plan')for(const stu of Object.values(people)){
  const pos=Number(stu.seat);if(Number.isInteger(pos)&&pos>=0&&pos<Math.min(9,Number(group.rows)||5)*Math.min(9,Number(group.cols)||5))seats['s'+pos]=['green','yellow','red'].includes(stu.status)?stu.status:'green';
 }
 return {green:visible?a.green:0,yellow:visible?a.yellow:0,red:visible?a.red:0,total:visible?a.total:0,visible,view,rows:Math.max(1,Math.min(9,Number(group.rows)||5)),cols:Math.max(1,Math.min(9,Number(group.cols)||5)),updated:Date.now(),...(Object.keys(seats).length?{seats}:{})};
}
const liveView=()=>current()?.projectionView==='plan'?'plan':'summary';
function setupBoard(){
 const uid=params.get('teacher'),cls=params.get('class');
 if(!uid||!cls||!/^[-\w]+$/.test(uid)||!/^[-\w]+$/.test(cls)){content.innerHTML='<section class="panel">Enlace de proyección incompleto. Genera el enlace desde el panel del profesor.</section>';return}
 content.className='board';setConnection('Conectando…');
 unsubBoard=onValue(ref(db,`boards/${uid}/${cls}`),snap=>{board=snap.val();setConnection('Sincronizado');drawBoard()},err=>{setConnection('Sin conexión');content.innerHTML=`<section class="panel error">No se puede leer el resumen: ${esc(err.message)}</section>`});
}
function drawBoard(){
 if(!board||!board.visible){content.innerHTML='<section class="panel"><h1>Semáforo de clase</h1><p class="empty">El resumen está oculto. El profesor lo mostrará cuando corresponda.</p></section>';return}
 content.innerHTML=`<h1>Semáforo de clase</h1>${countCards(board)}<p class="note">Cada persona puede mejorar su comportamiento. El objetivo es respetar los turnos de palabra.</p><p class="muted tiny" style="text-align:center">Datos agregados: no se muestran nombres ni avisos individuales.</p>`;
}
function setupTeacher(){
 onAuthStateChanged(auth,u=>{user=u;if(!u){unsubClasses();unsubStudents();classId=null;classes={};students={};setConnection('Acceso privado');loginForm()}else{setConnection('Conectado');subscribeClasses()}},err=>{setConnection('Error');showMessage(err.message,true)});
}
function loginForm(){content.className='container';content.innerHTML=`<section class="panel" style="max-width:480px;margin:40px auto"><h1>Acceso del profesor</h1><p class="muted">Entra con el usuario que creaste en Firebase Authentication. Los alumnos no necesitan ninguna cuenta.</p><form id="login"><label class="label">Correo electrónico</label><input type="email" id="email" required autocomplete="username"><label class="label">Contraseña</label><input type="password" id="password" required autocomplete="current-password"><label class="remember-line"><input type="checkbox" id="rememberLogin"> Mantener la sesión iniciada en este dispositivo</label><button class="btn" style="margin-top:16px;width:100%">Entrar</button></form><p class="tiny muted">La contraseña no se almacena en la aplicación. Safari o Chrome pueden ofrecer guardarla en su gestor seguro. No marques esta opción en equipos compartidos.</p></section>`;
 $('#login').onsubmit=async e=>{e.preventDefault();const b=$('#login button');b.disabled=true;try{await setPersistence(auth,$('#rememberLogin').checked?browserLocalPersistence:browserSessionPersistence);await signInWithEmailAndPassword(auth,$('#email').value,$('#password').value)}catch(err){showMessage('No se ha podido iniciar sesión. Comprueba tu correo y contraseña y que Email/Password esté activado.',true);b.disabled=false}};
}
function subscribeClasses(){unsubClasses();unsubClasses=onValue(ref(db,`teachers/${user.uid}/classes`),snap=>{classes=snap.val()||{};if(classId&&!classes[classId]){classId=null;unsubStudents();students={}};if(!classId){const ids=Object.keys(classes);if(ids.length)selectClass(ids[0]);else drawHome()}else drawTeacher()},err=>showMessage('Error leyendo clases: '+err.message,true))}
function selectClass(id){
 classId=id;students={};unsubStudents();
 // Siempre se oculta la proyección al cambiar de grupo.
 const group=classes[id];
 update(ref(db),{[`teachers/${user.uid}/classes/${id}/visible`]:false,[`live/${user.uid}`]:livePayload(id,group,{},false,group?.projectionView==='plan'?'plan':'summary')}).catch(e=>showMessage('No se pudo cambiar la proyección: '+e.message,true));
 unsubStudents=onValue(ref(db,`teachers/${user.uid}/students/${id}`),snap=>{if(classId!==id)return;students=snap.val()||{};drawTeacher()},err=>showMessage('Error leyendo alumnado: '+err.message,true));drawTeacher();
}
const root=()=>`<div class="flex between"><h1>Panel del profesor</h1><button class="btn ghost small" id="logout">Salir</button></div>`;
function drawHome(){content.className='container';content.innerHTML=`${root()}<section class="panel"><h2>Mis clases</h2>${Object.entries(classes).map(([id,c])=>`<button class="btn secondary" data-open="${esc(id)}">${esc(c.name)}</button>`).join(' ')||'<p class="muted">Todavía no has creado una clase.</p>'}<form id="newClass"><label class="label">Nombre de la clase (ej.: 2.º ESO B)</label><input id="newName" maxlength="70" required placeholder="2.º ESO B"><button class="btn" style="margin-top:10px">Crear clase</button></form></section>`;baseEvents();$('#newClass').onsubmit=createClass;content.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>selectClass(b.dataset.open))}
async function createClass(e){e.preventDefault();const name=$('#newName').value.trim();if(!name)return;const id=genId();try{await update(ref(db),{[`teachers/${user.uid}/classes/${id}`]:{name,cols:5,rows:5,visible:false,projectionView:'summary'},[`boards/${user.uid}/${id}`]:{green:0,yellow:0,red:0,total:0,visible:false,updated:Date.now()}});selectClass(id)}catch(err){showMessage(err.message,true)}}
function baseEvents(){const logout=$('#logout');if(logout)logout.onclick=()=>signOut(auth)}
function drawTeacher(){if(!user)return;if(!classId){drawHome();return}const c=current();if(!c)return;const a=counts();const url=new URL(location.href);url.search=`?mode=live&teacher=${encodeURIComponent(user.uid)}`;
 content.className='container';content.innerHTML=`${root()}<section class="panel"><div class="flex between"><div><span class="badge">${esc(c.name)}</span><h2 class="group-title">${a.total} alumnos · Sesión actual</h2></div><div><label class="tiny muted" for="classPicker">Clase</label><select id="classPicker" class="inline-select">${Object.entries(classes).map(([id,v])=>`<option value="${esc(id)}" ${id===classId?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div></div>${countCards(a)}<div class="flex" style="margin-top:13px"><button class="btn ${c.visible?'danger':'secondary'}" id="publish">${c.visible?'Ocultar resumen':'Mostrar resumen'}</button><button class="btn secondary" id="copyLink">Copiar enlace SMART fijo</button><button class="btn secondary" id="projectionView">${liveView()==='plan'?'Proyectar resumen':'Proyectar plano del aula'}</button></div><p class="tiny muted">La SMART utiliza el mismo enlace en todas tus clases. En el plano proyectado solo aparecen números de pupitres y colores, sin nombres.</p></section>
 <div class="tabs"><button class="tab ${page==='plan'?'active':''}" data-tab="plan">▦ Plano del aula</button><button class="tab ${page==='list'?'active':''}" data-tab="list">☷ Lista alfabética</button><button class="tab ${page==='config'?'active':''}" data-tab="config">⚙ Configurar</button></div>
 <section class="panel" id="view">${page==='plan'?drawPlan(c):page==='list'?drawList():drawConfig(c)}</section>`;
 baseEvents();$('#classPicker').onchange=e=>{page='plan';editSeats=false;selectClass(e.target.value)};content.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{page=b.dataset.tab;drawTeacher()});
 $('#publish').onclick=async()=>{try{await publish(!c.visible)}catch(e){showMessage('No se pudo publicar: '+e.message,true)}};
 $('#projectionView').onclick=async()=>{try{await changeProjectionView(liveView()==='plan'?'summary':'plan')}catch(e){showMessage('No se pudo cambiar de vista: '+e.message,true)}};
 $('#copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(url.href);showMessage('Enlace SMART copiado. Ábrelo en Edge o Chrome de la pizarra.')}catch(e){showMessage('Enlace: '+url.href)}};
 content.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>changeStatus(b.dataset.id,b.dataset.action));
 if(page==='plan')setupPlanEvents();if(page==='config')setupConfigEvents();
}
function drawList(){return `<div class="flex between"><h2>Lista alfabética</h2><span class="tiny muted">Pulsa un color para cambiar el estado</span></div>${sorted().map(s=>`<div class="student"><div><div class="student-name">${esc(s.name)}</div>${statusBadge(s.status||'green')}</div>${actionButtons(s)}</div>`).join('')||'<div class="empty">Añade alumnos desde Configurar.</div>'}`}
function actionButtons(s){return `<div class="controls"><button title="Poner verde" aria-label="Verde para ${esc(s.name)}" class="btn small green" data-action="green" data-id="${esc(s.id)}">✓</button><button title="Aviso amarillo" aria-label="Amarillo para ${esc(s.name)}" class="btn small yellow" data-action="yellow" data-id="${esc(s.id)}">!</button><button title="Rojo" aria-label="Rojo para ${esc(s.name)}" class="btn small red" data-action="red" data-id="${esc(s.id)}">×</button></div>`}
function drawPlan(c){const rows=Math.max(1,Math.min(9,Number(c.rows)||5)),cols=Math.max(1,Math.min(9,Number(c.cols)||5));const bySeat={};for(const s of sorted())if(Number.isInteger(s.seat)&&s.seat>=0&&s.seat<rows*cols)bySeat[s.seat]=s;
 let html=`<div class="flex between"><h2>Plano del aula</h2><button id="editSeats" class="btn secondary small">${editSeats?'Terminar distribución':'Cambiar distribución'}</button></div><div class="front">PIZARRA / PROFESOR</div><div class="seats" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">`;
 for(let i=0;i<cols*rows;i++){const s=bySeat[i],status=s?(['green','yellow','red'].includes(s.status)?s.status:'green'):'';
 html+=`<div class="seat ${s?'filled seat-'+status:''} ${editSeats?'seat-edit':''}" ${s?`title="${esc(s.name)}"`:''}>${s?`<div class="seat-student-name">${esc(s.name)}</div>`:`<small>${i+1}</small>`}${editSeats?`<button class="seat-hit" data-seat="${i}" aria-label="Asignar pupitre ${i+1}">${s?'Mover':'Asignar'}</button>`:s?`<button class="seat-hit" data-seat-status="${esc(s.id)}" aria-label="Registrar aviso para ${esc(s.name)}"></button>`:''}</div>`}
 return html+'</div><p class="tiny muted">'+(editSeats?'Toca un pupitre para asignar o cambiar de alumno.':'Toca el pupitre ocupado para cambiar su estado. El sombreado muestra el color sin ocupar espacio con etiquetas.')+'</p>'}
function setupPlanEvents(){$('#editSeats').onclick=()=>{editSeats=!editSeats;drawTeacher()};content.querySelectorAll('[data-seat]').forEach(b=>b.onclick=()=>seatDialog(Number(b.dataset.seat)));content.querySelectorAll('[data-seat-status]').forEach(b=>b.onclick=()=>statusDialog(b.dataset.seatStatus))}
function openDialog(html){const d=document.createElement('dialog');d.className='dialog';d.innerHTML=html;document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return d}
function statusDialog(id){const s=students[id];if(!s)return;const d=openDialog(`<h2>${esc(s.name)}</h2><p>Estado actual: ${statusBadge(s.status||'green')}</p><p class="muted tiny">Registra un aviso o reconoce la recuperación. El rojo requiere intervención individual según las normas del centro.</p><div class="flex">${actionButtons({id,name:s.name})}</div><button class="btn ghost" id="cancel">Cerrar</button>`);d.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{d.close();await changeStatus(id,b.dataset.action)});d.querySelector('#cancel').onclick=()=>d.close()}
function seatDialog(seat){const options=sorted().map(s=>`<option value="${esc(s.id)}" ${s.seat===seat?'selected':''}>${esc(s.name)}</option>`).join('');const d=openDialog(`<h2>Asignar pupitre ${seat+1}</h2><label class="label">Alumno</label><select id="seatStudent"><option value="">Dejar vacío</option>${options}</select><div class="flex"><button id="saveSeat" class="btn">Guardar</button><button id="closeSeat" class="btn ghost">Cancelar</button></div>`);d.querySelector('#saveSeat').onclick=async()=>{const id=d.querySelector('#seatStudent').value;const updates={};for(const [sid,s] of Object.entries(students))if(s.seat===seat||sid===id)updates[`teachers/${user.uid}/students/${classId}/${sid}/seat`]=null;if(id)updates[`teachers/${user.uid}/students/${classId}/${id}/seat`]=seat;try{
 const next=Object.fromEntries(Object.entries(students).map(([sid,stu])=>[sid,{...stu}]));
 for(const [sid,stu] of Object.entries(next))if(stu.seat===seat||sid===id)stu.seat=-1;
 if(id)next[id].seat=seat;
 updates[`live/${user.uid}`]=livePayload(classId,current(),next,!!current()?.visible,liveView());
 await update(ref(db),updates);d.close()
 }catch(e){alert(e.message)}};d.querySelector('#closeSeat').onclick=()=>d.close()}
function drawConfig(c){return `<h2>Configurar clase</h2><label class="label">Añadir alumnos (un nombre por línea)</label><textarea id="bulkNames" placeholder="Alumno 01&#10;Alumno 02&#10;Alumno 03"></textarea><button id="addNames" class="btn" style="margin-top:9px">Añadir alumnos</button><p class="tiny muted">Introduce nombres solo si el centro autoriza este tratamiento en la plataforma. Para probarla, utiliza códigos ficticios.</p><hr><h3>Distribución del aula</h3><div class="grid2"><div><label class="label">Filas</label><input id="rows" type="number" min="1" max="9" value="${Number(c.rows)||5}"></div><div><label class="label">Columnas</label><input id="cols" type="number" min="1" max="9" value="${Number(c.cols)||5}"></div></div><button class="btn secondary" id="saveGrid" style="margin-top:9px">Guardar distribución</button><hr><h3>Gestión de sesión</h3><p class="muted tiny">Restablecer deja todos los estados en verde sin borrar los alumnos ni sus pupitres. Los avisos no se guardan en un historial permanente.</p><button class="btn yellow" id="reset">Iniciar nueva sesión: todos en verde</button><hr><h3>Alumnado</h3>${sorted().map(s=>`<div class="student"><span class="student-name">${esc(s.name)}</span><button class="btn danger small" data-remove="${esc(s.id)}">Eliminar</button></div>`).join('')||'<p class="muted">No hay alumnos.</p>'}<hr><button class="btn secondary" id="newClassBtn">Crear otra clase</button> <button class="btn danger" id="deleteClass">Eliminar esta clase</button>`}
function setupConfigEvents(){$('#addNames').onclick=addNames;$('#saveGrid').onclick=async()=>{const rows=Number($('#rows').value),cols=Number($('#cols').value);if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||rows>9||cols<1||cols>9){showMessage('Indica entre 1 y 9 filas y columnas.',true);return}await update(ref(db),{[`teachers/${user.uid}/classes/${classId}/rows`]:rows,[`teachers/${user.uid}/classes/${classId}/cols`]:cols,[`live/${user.uid}`]:livePayload(classId,{...current(),rows,cols},students,!!current()?.visible,liveView())})};$('#reset').onclick=resetSession;content.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const s=students[b.dataset.remove];if(!confirm('¿Eliminar a '+s.name+' de esta clase?'))return;const next={...students};delete next[b.dataset.remove];await saveStudentsAndBoard(next)});$('#newClassBtn').onclick=()=>{classId=null;unsubStudents();students={};drawHome()};$('#deleteClass').onclick=async()=>{if(!confirm('¿Eliminar esta clase y todos sus datos? Esta acción no se puede deshacer.'))return;await update(ref(db),{[`teachers/${user.uid}/classes/${classId}`]:null,[`teachers/${user.uid}/students/${classId}`]:null,[`boards/${user.uid}/${classId}`]:null,[`live/${user.uid}`]:livePayload(classId,current(),{},false,liveView())});classId=null;students={};drawHome()}}
async function addNames(){const names=$('#bulkNames').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,60);if(!names.length)return;const next={...students};const existing=new Set(Object.values(next).map(s=>s.name.toLocaleLowerCase('es')));for(const name of names){if(existing.has(name.toLocaleLowerCase('es')))continue;existing.add(name.toLocaleLowerCase('es'));next[genId()]={name:name.slice(0,100),status:'green',seat:-1}}if(Object.keys(next).length>60){showMessage('Límite de 60 alumnos por clase.',true);return}await saveStudentsAndBoard(next);showMessage('Alumnos añadidos. Asigna sus pupitres en el plano.')}
function summaryFrom(next,visible){const a={green:0,yellow:0,red:0,total:0};for(const s of Object.values(next)){const status=['green','yellow','red'].includes(s.status)?s.status:'green';a[status]++;a.total++}return {...a,visible,updated:Date.now()}}
async function saveStudentsAndBoard(next){if(busy)return;busy=true;try{await update(ref(db),{[`teachers/${user.uid}/students/${classId}`]:next,[`boards/${user.uid}/${classId}`]:summaryFrom(next,!!current()?.visible),[`live/${user.uid}`]:livePayload(classId,current(),next,!!current()?.visible,liveView())})}catch(e){showMessage('No se pudo guardar: '+e.message,true)}finally{busy=false}}
async function changeStatus(id,status){if(!['green','yellow','red'].includes(status)||!students[id]||busy)return;const next={...students,[id]:{...students[id],status}};await saveStudentsAndBoard(next)}
async function publish(visible){if(busy)return;busy=true;try{await update(ref(db),{[`teachers/${user.uid}/classes/${classId}/visible`]:visible,[`boards/${user.uid}/${classId}`]:summaryFrom(students,visible),[`live/${user.uid}`]:livePayload(classId,current(),students,visible,liveView())})}finally{busy=false}}
async function resetSession(){if(!confirm('¿Iniciar otra sesión y poner a todo el alumnado en verde?'))return;const next=Object.fromEntries(Object.entries(students).map(([id,s])=>[id,{...s,status:'green'}]));await saveStudentsAndBoard(next)}

async function changeProjectionView(view){
 if(busy)return;busy=true;
 try{await update(ref(db),{[`teachers/${user.uid}/classes/${classId}/projectionView`]:view,[`live/${user.uid}`]:livePayload(classId,current(),students,!!current()?.visible,view)})}
 finally{busy=false}
}
