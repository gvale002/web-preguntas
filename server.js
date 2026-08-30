const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const QUIZ_FILE = path.join(DATA, 'quizzes.json');
const USER_FILE = path.join(DATA, 'users.json');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(QUIZ_FILE)) fs.writeFileSync(QUIZ_FILE, JSON.stringify({ quizzes: [] }, null, 2));
if (!fs.existsSync(USER_FILE)) fs.writeFileSync(USER_FILE, JSON.stringify({ users: [] }, null, 2));

const sessions = new Map();
const sseClients = new Map();
const authSessions = new Map();
const oauthStates = new Map();

function token(bytes=18) { return crypto.randomBytes(bytes).toString('hex'); }
function loadQuizzes() { try { return JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf8')).quizzes || []; } catch { return []; } }
function saveQuizzes(quizzes) { fs.writeFileSync(QUIZ_FILE, JSON.stringify({ quizzes }, null, 2)); }
function loadUsers() { try { return JSON.parse(fs.readFileSync(USER_FILE, 'utf8')).users || []; } catch { return []; } }
function saveUsers(users) { fs.writeFileSync(USER_FILE, JSON.stringify({ users }, null, 2)); }
function sendJson(res, status, data) { const body=JSON.stringify(data); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'}); res.end(body); }
function redirect(res, location) { res.writeHead(302,{Location:location,'Cache-Control':'no-store'}); res.end(); }
function readJson(req) { return new Promise((resolve,reject)=>{ let body=''; req.on('data',c=>{body+=c;if(body.length>8_000_000)req.destroy();}); req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch(e){reject(e);}}); req.on('error',reject); }); }
function parseCookies(req){ const out={}; String(req.headers.cookie||'').split(';').forEach(v=>{const i=v.indexOf('=');if(i>0)out[decodeURIComponent(v.slice(0,i).trim())]=decodeURIComponent(v.slice(i+1).trim());}); return out; }
function isSecureRequest(req){ return String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https'; }
function setSessionCookie(req,res,sid){ const attrs=[`giotk_session=${encodeURIComponent(sid)}`,'Path=/','HttpOnly','SameSite=Lax',`Max-Age=${60*60*24*14}`]; if(isSecureRequest(req)) attrs.push('Secure'); res.setHeader('Set-Cookie',attrs.join('; ')); }
function clearSessionCookie(req,res){ const attrs=['giotk_session=','Path=/','HttpOnly','SameSite=Lax','Max-Age=0']; if(isSecureRequest(req))attrs.push('Secure'); res.setHeader('Set-Cookie',attrs.join('; ')); }
function currentAuth(req){ const sid=parseCookies(req).giotk_session; const s=sid?authSessions.get(sid):null; if(!s)return null; if(s.expiresAt<Date.now()){authSessions.delete(sid);return null;} return s; }
function publicUser(u){ return u?{id:u.id,provider:u.provider,email:u.email||'',name:u.name||'',picture:u.picture||'',createdAt:u.createdAt,lastLoginAt:u.lastLoginAt,isUserAdmin:isUserAdmin(u)}:null; }
function isUserAdmin(u){ return /@altronics\.cl$/i.test(String(u?.email||'').trim()); }
function requireAuth(req,res){ const s=currentAuth(req); if(!s){sendJson(res,401,{error:'Debes iniciar sesión'});return null;} return s; }
function requireUserAdmin(req,res){ const s=requireAuth(req,res); if(!s)return null; const u=loadUsers().find(x=>x.id===s.userId); if(!isUserAdmin(u)){sendJson(res,403,{error:'Solo usuarios @altronics.cl pueden administrar usuarios'});return null;} return {session:s,user:u}; }
function baseUrl(req){ if(process.env.PUBLIC_BASE_URL)return process.env.PUBLIC_BASE_URL.replace(/\/+$/,''); const proto=req.headers['x-forwarded-proto']||'http'; return `${proto}://${req.headers.host||`localhost:${PORT}`}`; }

const providers={
  google:{label:'Google',clientId:()=>process.env.GOOGLE_CLIENT_ID,clientSecret:()=>process.env.GOOGLE_CLIENT_SECRET,auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'openid email profile',userinfo:'https://openidconnect.googleapis.com/v1/userinfo'},
  facebook:{label:'Facebook',clientId:()=>process.env.FACEBOOK_CLIENT_ID,clientSecret:()=>process.env.FACEBOOK_CLIENT_SECRET,auth:process.env.FACEBOOK_AUTH_URL||'https://www.facebook.com/v23.0/dialog/oauth',token:process.env.FACEBOOK_TOKEN_URL||'https://graph.facebook.com/v23.0/oauth/access_token',scope:'email public_profile',userinfo:process.env.FACEBOOK_USERINFO_URL||'https://graph.facebook.com/me?fields=id,name,email,picture.type(large)'},
  linkedin:{label:'LinkedIn',clientId:()=>process.env.LINKEDIN_CLIENT_ID,clientSecret:()=>process.env.LINKEDIN_CLIENT_SECRET,auth:'https://www.linkedin.com/oauth/v2/authorization',token:'https://www.linkedin.com/oauth/v2/accessToken',scope:'openid profile email',userinfo:'https://api.linkedin.com/v2/userinfo'},
  instagram:{label:'Instagram',clientId:()=>process.env.INSTAGRAM_CLIENT_ID,clientSecret:()=>process.env.INSTAGRAM_CLIENT_SECRET,auth:process.env.INSTAGRAM_AUTH_URL||'https://www.instagram.com/oauth/authorize',token:process.env.INSTAGRAM_TOKEN_URL||'https://api.instagram.com/oauth/access_token',scope:process.env.INSTAGRAM_SCOPE||'instagram_business_basic',userinfo:process.env.INSTAGRAM_USERINFO_URL||'https://graph.instagram.com/me?fields=id,user_id,username,name,profile_picture_url'}
};
function providerConfigured(p){ const x=providers[p]; return !!(x&&x.clientId()&&x.clientSecret()); }
async function fetchJson(url,opts={}){ const r=await fetch(url,opts); const text=await r.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={raw:text};} if(!r.ok)throw new Error(data.error_description||data.error?.message||data.error||`HTTP ${r.status}`); return data; }
async function exchangeCode(provider,code,redirectUri){ const p=providers[provider]; const params=new URLSearchParams({client_id:p.clientId(),client_secret:p.clientSecret(),redirect_uri:redirectUri,code,grant_type:'authorization_code'}); if(provider==='instagram') return fetchJson(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params}); return fetchJson(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:params}); }
async function fetchProfile(provider,accessToken){ const p=providers[provider]; const sep=p.userinfo.includes('?')?'&':'?'; return fetchJson(`${p.userinfo}${sep}access_token=${encodeURIComponent(accessToken)}`,{headers:{Authorization:`Bearer ${accessToken}`,'Accept':'application/json'}}); }
function normalizeProfile(provider,data){
  if(provider==='google') return {providerId:String(data.sub||''),email:data.email||'',name:data.name||data.email||'Usuario Google',picture:data.picture||''};
  if(provider==='facebook') return {providerId:String(data.id||''),email:data.email||'',name:data.name||data.email||'Usuario Facebook',picture:data.picture?.data?.url||''};
  if(provider==='linkedin') return {providerId:String(data.sub||''),email:data.email||'',name:data.name||[data.given_name,data.family_name].filter(Boolean).join(' ')||data.email||'Usuario LinkedIn',picture:data.picture||''};
  if(provider==='instagram') return {providerId:String(data.user_id||data.id||''),email:'',name:data.name||data.username||'Usuario Instagram',picture:data.profile_picture_url||''};
  return {providerId:'',email:'',name:'Usuario',picture:''};
}
function upsertUser(profile,provider){ const users=loadUsers(); let u=users.find(x=>x.provider===provider&&x.providerId===profile.providerId); const now=new Date().toISOString(); if(!u){u={id:token(),provider,providerId:profile.providerId,email:profile.email||'',name:profile.name||'',picture:profile.picture||'',createdAt:now,lastLoginAt:now};users.push(u);}else{u.email=profile.email||u.email||'';u.name=profile.name||u.name||'';u.picture=profile.picture||u.picture||'';u.lastLoginAt=now;} saveUsers(users); return u; }

function safeQuizForPlayer(q){ if(!q)return null; return {id:q.id,type:q.type,text:q.text,options:q.options||[],duration:q.duration||20,image:q.image||'',layout:q.layout||{textSize:42,imageSize:34,answersPosition:'bottom'}}; }
function randomCode(){ for(let i=0;i<20;i++){const code=String(Math.floor(100000+Math.random()*900000));if(!sessions.has(code))return code;} return String(Date.now()).slice(-6); }
function normalizeText(v){return String(v??'').trim().toLocaleLowerCase('es');}
function isCorrect(question,answer){ if(question.type==='single'||question.type==='truefalse')return String(answer)===String(question.correct); if(question.type==='multiple'){const a=Array.isArray(answer)?answer.map(String).sort():[],c=Array.isArray(question.correct)?question.correct.map(String).sort():[];return a.length===c.length&&a.every((v,i)=>v===c[i]);} if(question.type==='text'){const accepted=Array.isArray(question.correct)?question.correct:[question.correct];return accepted.some(v=>normalizeText(v)===normalizeText(answer));} return false; }
function formatCorrectAnswer(q){ if(!q)return ''; if(q.type==='single'||q.type==='truefalse'){const i=Number(q.correct);return Number.isInteger(i)&&q.options?.[i]!=null?`${String.fromCharCode(65+i)} · ${q.options[i]}`:String(q.correct??'');} if(q.type==='multiple'){const ids=Array.isArray(q.correct)?q.correct:[];return ids.map(v=>{const i=Number(v);return Number.isInteger(i)&&q.options?.[i]!=null?`${String.fromCharCode(65+i)} · ${q.options[i]}`:String(v);}).join(' / ');} if(q.type==='text')return(Array.isArray(q.correct)?q.correct:[q.correct]).filter(Boolean).join(' / '); return String(q.correct??''); }
function publicSession(session,playerId=null){ const q=session.quiz.questions[session.currentQuestion]||null,players=[...session.players.values()].map(p=>({id:p.id,name:p.name,score:p.score})),me=playerId?session.players.get(playerId):null,now=Date.now(),remainingMs=session.questionEndsAt?Math.max(0,session.questionEndsAt-now):0; const result=session.state==='result'&&q?{correct:q.correct,correctDisplay:formatCorrectAnswer(q),winner:session.questionWinner,counts:session.resultCounts||{},questionIndex:session.currentQuestion}:null; return {code:session.code,quizTitle:session.quiz.title,state:session.state,currentQuestion:session.currentQuestion,totalQuestions:session.quiz.questions.length,question:session.state==='question'?safeQuizForPlayer(q):null,questionEndsAt:session.questionEndsAt,remainingMs,result,players,me:me?{id:me.id,name:me.name,score:me.score}:null,ranking:[...players].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)),joinedCount:players.length,maxPlayers:100}; }
function broadcast(code){ const set=sseClients.get(code); if(!set)return; for(const client of [...set]){const session=sessions.get(code);if(!session)continue;try{client.res.write(`data: ${JSON.stringify(publicSession(session,client.playerId))}\n\n`);}catch{set.delete(client);}} }
function finishQuestion(session){ if(!session||session.state!=='question')return;if(session.timer)clearTimeout(session.timer);const q=session.quiz.questions[session.currentQuestion],correctAnswers=[...session.answers.values()].filter(a=>a.correct).sort((a,b)=>a.elapsedMs-b.elapsedMs);session.questionWinner=correctAnswers.length?{playerId:correctAnswers[0].playerId,name:session.players.get(correctAnswers[0].playerId)?.name||'',elapsedMs:correctAnswers[0].elapsedMs}:null;const counts={};for(const a of session.answers.values()){const k=Array.isArray(a.answer)?a.answer.join(','):String(a.answer);counts[k]=(counts[k]||0)+1;}session.resultCounts=counts;session.state='result';session.questionEndsAt=null;broadcast(session.code); }
function startQuestion(session){ if(!session)return false;if(session.state==='lobby')session.currentQuestion=0;else if(session.state==='result')session.currentQuestion+=1;else return false;if(session.currentQuestion>=session.quiz.questions.length){session.state='finished';broadcast(session.code);return true;}session.answers=new Map();session.questionWinner=null;session.resultCounts={};session.state='question';const q=session.quiz.questions[session.currentQuestion],duration=Math.max(5,Number(q.duration||20));session.questionStartedAt=Date.now();session.questionEndsAt=session.questionStartedAt+duration*1000;session.timer=setTimeout(()=>finishQuestion(session),duration*1000+50);broadcast(session.code);return true; }

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
function serveFile(res,file){ const normalized=path.normalize(file);if(!normalized.startsWith(PUBLIC))return sendJson(res,403,{error:'forbidden'});fs.readFile(normalized,(err,data)=>{if(err)return sendJson(res,404,{error:'not found'});res.writeHead(200,{'Content-Type':mime[path.extname(normalized).toLowerCase()]||'application/octet-stream'});res.end(data);}); }

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`),rawPath=decodeURIComponent(u.pathname),p=rawPath.length>1?rawPath.replace(/\/+$/,''):rawPath;
  try{
    if(req.method==='GET'&&p==='/health')return sendJson(res,200,{ok:true,app:'G IOTK',version:'1.9.0'});

    if(req.method==='GET'&&p==='/api/auth/providers')return sendJson(res,200,{providers:Object.fromEntries(Object.entries(providers).map(([k,v])=>[k,{label:v.label,configured:providerConfigured(k)}]))});
    if(req.method==='GET'&&p==='/api/auth/me'){const a=currentAuth(req);if(!a)return sendJson(res,200,{user:null});const user=loadUsers().find(x=>x.id===a.userId);return sendJson(res,200,{user:publicUser(user)});}
    if(req.method==='GET'&&p.startsWith('/auth/login/')){
      const provider=p.split('/').pop(),cfg=providers[provider]; if(!cfg)return sendJson(res,404,{error:'Proveedor no válido'}); if(!providerConfigured(provider))return redirect(res,`/login?error=${encodeURIComponent(`${cfg.label} no está configurado todavía.`)}`);
      const state=token(),redirectUri=`${baseUrl(req)}/auth/callback/${provider}`;oauthStates.set(state,{provider,redirectUri,expiresAt:Date.now()+10*60*1000});const q=new URLSearchParams({client_id:cfg.clientId(),redirect_uri:redirectUri,response_type:'code',scope:cfg.scope,state}); if(provider==='google')q.set('prompt','select_account'); return redirect(res,`${cfg.auth}?${q}`);
    }
    if(req.method==='GET'&&p.startsWith('/auth/callback/')){
      const provider=p.split('/').pop(),cfg=providers[provider],state=u.searchParams.get('state'),record=oauthStates.get(state);oauthStates.delete(state); if(!cfg||!record||record.provider!==provider||record.expiresAt<Date.now())return redirect(res,'/login?error=La%20sesión%20de%20inicio%20expiró.'); if(u.searchParams.get('error'))return redirect(res,`/login?error=${encodeURIComponent(u.searchParams.get('error_description')||u.searchParams.get('error'))}`); const code=u.searchParams.get('code');if(!code)return redirect(res,'/login?error=No%20se%20recibió%20el%20código%20de%20autorización.');
      try{const td=await exchangeCode(provider,code,record.redirectUri),accessToken=td.access_token;if(!accessToken)throw new Error('El proveedor no devolvió access_token');const pd=await fetchProfile(provider,accessToken),profile=normalizeProfile(provider,pd);if(!profile.providerId)throw new Error('No se pudo identificar al usuario');const user=upsertUser(profile,provider),sid=token(24);authSessions.set(sid,{userId:user.id,createdAt:Date.now(),expiresAt:Date.now()+14*24*60*60*1000});setSessionCookie(req,res,sid);return redirect(res,'/admin');}catch(e){console.error('OAuth',provider,e);return redirect(res,`/login?error=${encodeURIComponent(`No fue posible iniciar sesión con ${cfg.label}: ${e.message}`)}`);}
    }
    if(req.method==='POST'&&p==='/api/auth/logout'){const sid=parseCookies(req).giotk_session;if(sid)authSessions.delete(sid);clearSessionCookie(req,res);return sendJson(res,200,{ok:true});}
    if(req.method==='GET'&&p==='/api/users'){const a=requireUserAdmin(req,res);if(!a)return;return sendJson(res,200,{users:loadUsers().map(publicUser)});}
    if(req.method==='DELETE'&&p.startsWith('/api/users/')){const a=requireUserAdmin(req,res);if(!a)return;const id=p.split('/').pop();if(id===a.user.id)return sendJson(res,409,{error:'No puedes eliminar tu propio usuario mientras tienes la sesión iniciada.'});saveUsers(loadUsers().filter(x=>x.id!==id));for(const [sid,s] of authSessions){if(s.userId===id)authSessions.delete(sid);}return sendJson(res,200,{ok:true});}

    if(req.method==='GET'&&p==='/api/quizzes'){if(!requireAuth(req,res))return;return sendJson(res,200,{quizzes:loadQuizzes()});}
    if(req.method==='POST'&&p==='/api/quizzes'){if(!requireAuth(req,res))return;const body=await readJson(req),quizzes=loadQuizzes(),quiz=body.quiz||{};quiz.id=quiz.id||token();quiz.updatedAt=new Date().toISOString();quiz.questions=Array.isArray(quiz.questions)?quiz.questions.map(q=>({...q,id:q.id||token(),duration:Number(q.duration||20)})):[];const idx=quizzes.findIndex(x=>x.id===quiz.id);if(idx>=0)quizzes[idx]=quiz;else quizzes.push(quiz);saveQuizzes(quizzes);return sendJson(res,200,{quiz});}
    if(req.method==='DELETE'&&p.startsWith('/api/quizzes/')){if(!requireAuth(req,res))return;const id=p.split('/').pop();saveQuizzes(loadQuizzes().filter(q=>q.id!==id));return sendJson(res,200,{ok:true});}
    if(req.method==='POST'&&p==='/api/sessions'){if(!requireAuth(req,res))return;const body=await readJson(req),quiz=loadQuizzes().find(q=>q.id===body.quizId);if(!quiz)return sendJson(res,404,{error:'Quiz no encontrado'});const code=randomCode(),adminToken=token();sessions.set(code,{code,adminToken,quiz:JSON.parse(JSON.stringify(quiz)),state:'lobby',currentQuestion:-1,players:new Map(),answers:new Map(),createdAt:Date.now()});const base=baseUrl(req);return sendJson(res,200,{code,adminToken,presenterUrl:`${base}/presenter?code=${code}&token=${adminToken}`,joinUrl:`${base}/play?code=${code}`});}
    if(req.method==='POST'&&p==='/api/join'){const body=await readJson(req),session=sessions.get(String(body.code||''));if(!session)return sendJson(res,404,{error:'Código no válido'});if(session.players.size>=100)return sendJson(res,409,{error:'La sala alcanzó el máximo de 100 jugadores'});const name=String(body.name||'').trim().slice(0,30);if(!name)return sendJson(res,400,{error:'Ingresa un nombre o apodo'});const id=token();session.players.set(id,{id,name,score:0,joinedAt:Date.now()});broadcast(session.code);return sendJson(res,200,{playerId:id,session:publicSession(session,id)});}
    if(req.method==='POST'&&p==='/api/answer'){const body=await readJson(req),s=sessions.get(String(body.code||''));if(!s||s.state!=='question')return sendJson(res,409,{error:'No hay una pregunta activa'});const player=s.players.get(String(body.playerId||''));if(!player)return sendJson(res,403,{error:'Jugador no válido'});if(s.answers.has(player.id))return sendJson(res,409,{error:'Respuesta ya enviada'});if(Date.now()>s.questionEndsAt){finishQuestion(s);return sendJson(res,409,{error:'Tiempo terminado'});}const q=s.quiz.questions[s.currentQuestion],correct=isCorrect(q,body.answer),elapsedMs=Math.max(0,Date.now()-s.questionStartedAt),durationMs=Math.max(1,(q.duration||20)*1000);let points=0;if(correct)points=Math.max(100,Math.round(1000-700*(elapsedMs/durationMs)));player.score+=points;s.answers.set(player.id,{playerId:player.id,answer:body.answer,correct,elapsedMs,points});broadcast(s.code);return sendJson(res,200,{ok:true,correct:null,points:null});}
    if(req.method==='POST'&&p==='/api/presenter/next'){const b=await readJson(req),s=sessions.get(String(b.code||''));if(!s||s.adminToken!==b.token)return sendJson(res,403,{error:'No autorizado'});if(s.state==='question')return sendJson(res,409,{error:'La pregunta aún está activa'});startQuestion(s);return sendJson(res,200,{session:publicSession(s)});}
    if(req.method==='POST'&&p==='/api/presenter/end-question'){const b=await readJson(req),s=sessions.get(String(b.code||''));if(!s||s.adminToken!==b.token)return sendJson(res,403,{error:'No autorizado'});finishQuestion(s);return sendJson(res,200,{ok:true});}
    if(req.method==='GET'&&p==='/api/session'){const code=u.searchParams.get('code'),s=sessions.get(String(code||''));if(!s)return sendJson(res,404,{error:'Sesión no encontrada'});return sendJson(res,200,{session:publicSession(s,u.searchParams.get('playerId'))});}
    if(req.method==='GET'&&p==='/events'){const code=u.searchParams.get('code'),s=sessions.get(String(code||''));if(!s){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});res.write('retry: 1500\n\n');const client={res,playerId:u.searchParams.get('playerId')||null};if(!sseClients.has(code))sseClients.set(code,new Set());sseClients.get(code).add(client);res.write(`data: ${JSON.stringify(publicSession(s,client.playerId))}\n\n`);req.on('close',()=>sseClients.get(code)?.delete(client));return;}
    if(req.method==='GET'&&p.startsWith('/api/qr/')){const code=p.split('/').pop(),s=sessions.get(code);if(!s)return sendJson(res,404,{error:'Sesión no encontrada'});const payload=`${baseUrl(req)}/play?code=${code}`,py=spawn('python3',[path.join(ROOT,'scripts','make_qr.py'),payload]);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});py.stdout.pipe(res);py.stderr.on('data',()=>{});py.on('error',()=>res.end());return;}

    if(req.method==='GET'&&p==='/login')return serveFile(res,path.join(PUBLIC,'login.html'));
    if(req.method==='GET'&&(p==='/'||p==='/admin')){if(!currentAuth(req))return redirect(res,'/login');return serveFile(res,path.join(PUBLIC,'admin.html'));}
    if(req.method==='GET'&&p==='/users'){const a=currentAuth(req),user=a?loadUsers().find(x=>x.id===a.userId):null;if(!a)return redirect(res,'/login');if(!isUserAdmin(user))return redirect(res,'/admin?error=users');return serveFile(res,path.join(PUBLIC,'users.html'));}
    if(req.method==='GET'&&p==='/presenter')return serveFile(res,path.join(PUBLIC,'presenter.html'));
    if(req.method==='GET'&&p==='/preview'){if(!currentAuth(req))return redirect(res,'/login');return serveFile(res,path.join(PUBLIC,'preview.html'));}
    if(req.method==='GET'&&p==='/play')return serveFile(res,path.join(PUBLIC,'player.html'));
    if(req.method==='GET')return serveFile(res,path.join(PUBLIC,p.replace(/^\//,'')));
    return sendJson(res,404,{error:'not found'});
  }catch(e){console.error(e);return sendJson(res,500,{error:'Error interno',detail:String(e.message||e)});}
});
server.listen(PORT,HOST,()=>console.log(`G IOTK 1.9.0 activa en http://localhost:${PORT}`));
