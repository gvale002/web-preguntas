const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const QUIZ_FILE = path.join(DATA, 'quizzes.json');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(QUIZ_FILE)) fs.writeFileSync(QUIZ_FILE, JSON.stringify({ quizzes: [] }, null, 2));

const sessions = new Map();
const sseClients = new Map();

function loadQuizzes() {
  try { return JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf8')).quizzes || []; }
  catch { return []; }
}
function saveQuizzes(quizzes) {
  fs.writeFileSync(QUIZ_FILE, JSON.stringify({ quizzes }, null, 2));
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body='';
    req.on('data', c => { body += c; if (body.length > 8_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function safeQuizForPlayer(q) {
  if (!q) return null;
  return { id:q.id, type:q.type, text:q.text, options:q.options || [], duration:q.duration || 20, image:q.image || '', layout:q.layout || {textSize:42,imageSize:34,answersPosition:'bottom'} };
}
function randomCode() {
  for (let i=0;i<20;i++) {
    const code = String(Math.floor(100000 + Math.random()*900000));
    if (!sessions.has(code)) return code;
  }
  return String(Date.now()).slice(-6);
}
function token() { return crypto.randomBytes(12).toString('hex'); }
function normalizeText(v){ return String(v ?? '').trim().toLocaleLowerCase('es'); }
function isCorrect(question, answer) {
  if (question.type === 'single' || question.type === 'truefalse') return String(answer) === String(question.correct);
  if (question.type === 'multiple') {
    const a = Array.isArray(answer) ? answer.map(String).sort() : [];
    const c = Array.isArray(question.correct) ? question.correct.map(String).sort() : [];
    return a.length === c.length && a.every((v,i)=>v===c[i]);
  }
  if (question.type === 'text') {
    const accepted = Array.isArray(question.correct) ? question.correct : [question.correct];
    return accepted.some(v => normalizeText(v) === normalizeText(answer));
  }
  return false;
}
function formatCorrectAnswer(q) {
  if (!q) return '';
  if (q.type === 'single' || q.type === 'truefalse') {
    const i = Number(q.correct);
    return Number.isInteger(i) && q.options?.[i] != null ? `${String.fromCharCode(65+i)} · ${q.options[i]}` : String(q.correct ?? '');
  }
  if (q.type === 'multiple') {
    const ids = Array.isArray(q.correct) ? q.correct : [];
    return ids.map(v => { const i=Number(v); return Number.isInteger(i) && q.options?.[i] != null ? `${String.fromCharCode(65+i)} · ${q.options[i]}` : String(v); }).join(' / ');
  }
  if (q.type === 'text') return (Array.isArray(q.correct) ? q.correct : [q.correct]).filter(Boolean).join(' / ');
  return String(q.correct ?? '');
}
function publicSession(session, playerId=null) {
  const q = session.quiz.questions[session.currentQuestion] || null;
  const players = [...session.players.values()].map(p => ({ id:p.id, name:p.name, score:p.score }));
  const me = playerId ? session.players.get(playerId) : null;
  const now = Date.now();
  const remainingMs = session.questionEndsAt ? Math.max(0, session.questionEndsAt-now) : 0;
  const result = session.state === 'result' && q ? {
    correct: q.correct,
    correctDisplay: formatCorrectAnswer(q),
    winner: session.questionWinner,
    counts: session.resultCounts || {},
    questionIndex: session.currentQuestion
  } : null;
  return {
    code: session.code,
    quizTitle: session.quiz.title,
    state: session.state,
    currentQuestion: session.currentQuestion,
    totalQuestions: session.quiz.questions.length,
    question: session.state === 'question' ? safeQuizForPlayer(q) : null,
    questionEndsAt: session.questionEndsAt,
    remainingMs,
    result,
    players,
    me: me ? { id:me.id, name:me.name, score:me.score } : null,
    ranking: [...players].sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name)),
    joinedCount: players.length,
    maxPlayers: 100
  };
}
function broadcast(code) {
  const set = sseClients.get(code);
  if (!set) return;
  for (const client of [...set]) {
    const session = sessions.get(code);
    if (!session) continue;
    try { client.res.write(`data: ${JSON.stringify(publicSession(session, client.playerId))}\n\n`); }
    catch { set.delete(client); }
  }
}
function finishQuestion(session) {
  if (!session || session.state !== 'question') return;
  if (session.timer) clearTimeout(session.timer);
  const q = session.quiz.questions[session.currentQuestion];
  const correctAnswers = [...session.answers.values()].filter(a=>a.correct).sort((a,b)=>a.elapsedMs-b.elapsedMs);
  session.questionWinner = correctAnswers.length ? { playerId:correctAnswers[0].playerId, name:session.players.get(correctAnswers[0].playerId)?.name || '', elapsedMs:correctAnswers[0].elapsedMs } : null;
  const counts = {};
  for (const a of session.answers.values()) {
    const k = Array.isArray(a.answer) ? a.answer.join(',') : String(a.answer);
    counts[k] = (counts[k] || 0) + 1;
  }
  session.resultCounts = counts;
  session.state = 'result';
  session.questionEndsAt = null;
  broadcast(session.code);
}
function startQuestion(session) {
  if (!session) return false;
  if (session.state === 'lobby') session.currentQuestion = 0;
  else if (session.state === 'result') session.currentQuestion += 1;
  else return false;
  if (session.currentQuestion >= session.quiz.questions.length) {
    session.state = 'finished';
    broadcast(session.code);
    return true;
  }
  session.answers = new Map();
  session.questionWinner = null;
  session.resultCounts = {};
  session.state = 'question';
  const q = session.quiz.questions[session.currentQuestion];
  const duration = Math.max(5, Number(q.duration || 20));
  session.questionStartedAt = Date.now();
  session.questionEndsAt = session.questionStartedAt + duration*1000;
  session.timer = setTimeout(()=>finishQuestion(session), duration*1000 + 50);
  broadcast(session.code);
  return true;
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
function serveFile(res, file) {
  if (!file.startsWith(PUBLIC)) return sendJson(res,403,{error:'forbidden'});
  fs.readFile(file,(err,data)=>{
    if (err) return sendJson(res,404,{error:'not found'});
    res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'}); res.end(data);
  });
}

const server = http.createServer(async (req,res)=>{
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawPath = decodeURIComponent(u.pathname);
  const p = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  try {
    if (req.method === 'GET' && p === '/health') return sendJson(res,200,{ok:true,app:'G IOTK',version:'1.8.2'});
    if (req.method === 'GET' && p === '/api/quizzes') return sendJson(res,200,{quizzes:loadQuizzes()});
    if (req.method === 'POST' && p === '/api/quizzes') {
      const body = await readJson(req); const quizzes = loadQuizzes();
      const quiz = body.quiz || {}; quiz.id = quiz.id || token(); quiz.updatedAt = new Date().toISOString();
      quiz.questions = Array.isArray(quiz.questions) ? quiz.questions.map((q,i)=>({...q,id:q.id||token(),duration:Number(q.duration||20)})) : [];
      const idx = quizzes.findIndex(x=>x.id===quiz.id); if(idx>=0) quizzes[idx]=quiz; else quizzes.push(quiz); saveQuizzes(quizzes);
      return sendJson(res,200,{quiz});
    }
    if (req.method === 'DELETE' && p.startsWith('/api/quizzes/')) {
      const id = p.split('/').pop(); saveQuizzes(loadQuizzes().filter(q=>q.id!==id)); return sendJson(res,200,{ok:true});
    }
    if (req.method === 'POST' && p === '/api/sessions') {
      const body = await readJson(req); const quiz = loadQuizzes().find(q=>q.id===body.quizId); if(!quiz) return sendJson(res,404,{error:'Quiz no encontrado'});
      const code=randomCode(); const adminToken=token();
      sessions.set(code,{code,adminToken,quiz:JSON.parse(JSON.stringify(quiz)),state:'lobby',currentQuestion:-1,players:new Map(),answers:new Map(),createdAt:Date.now()});
      const proto = req.headers['x-forwarded-proto'] || 'http'; const host=req.headers.host || `localhost:${PORT}`;
      return sendJson(res,200,{code,adminToken,presenterUrl:`${proto}://${host}/presenter?code=${code}&token=${adminToken}`,joinUrl:`${proto}://${host}/play?code=${code}`});
    }
    if (req.method === 'POST' && p === '/api/join') {
      const body=await readJson(req); const session=sessions.get(String(body.code||'')); if(!session) return sendJson(res,404,{error:'Código no válido'});
      if(session.players.size>=100) return sendJson(res,409,{error:'La sala alcanzó el máximo de 100 jugadores'});
      const name=String(body.name||'').trim().slice(0,30); if(!name) return sendJson(res,400,{error:'Ingresa un nombre o apodo'});
      const id=token(); session.players.set(id,{id,name,score:0,joinedAt:Date.now()}); broadcast(session.code); return sendJson(res,200,{playerId:id,session:publicSession(session,id)});
    }
    if (req.method === 'POST' && p === '/api/answer') {
      const body=await readJson(req); const s=sessions.get(String(body.code||'')); if(!s || s.state!=='question') return sendJson(res,409,{error:'No hay una pregunta activa'});
      const player=s.players.get(String(body.playerId||'')); if(!player) return sendJson(res,403,{error:'Jugador no válido'});
      if(s.answers.has(player.id)) return sendJson(res,409,{error:'Respuesta ya enviada'});
      if(Date.now()>s.questionEndsAt) { finishQuestion(s); return sendJson(res,409,{error:'Tiempo terminado'}); }
      const q=s.quiz.questions[s.currentQuestion]; const correct=isCorrect(q,body.answer); const elapsedMs=Math.max(0,Date.now()-s.questionStartedAt); const durationMs=Math.max(1,(q.duration||20)*1000);
      let points=0; if(correct) points=Math.max(100,Math.round(1000 - 700*(elapsedMs/durationMs)));
      player.score += points; s.answers.set(player.id,{playerId:player.id,answer:body.answer,correct,elapsedMs,points}); broadcast(s.code);
      return sendJson(res,200,{ok:true,correct:null,points:null});
    }
    if (req.method === 'POST' && p === '/api/presenter/next') {
      const b=await readJson(req); const s=sessions.get(String(b.code||'')); if(!s || s.adminToken!==b.token) return sendJson(res,403,{error:'No autorizado'});
      if(s.state==='question') return sendJson(res,409,{error:'La pregunta aún está activa'});
      startQuestion(s); return sendJson(res,200,{session:publicSession(s)});
    }
    if (req.method === 'POST' && p === '/api/presenter/end-question') {
      const b=await readJson(req); const s=sessions.get(String(b.code||'')); if(!s || s.adminToken!==b.token) return sendJson(res,403,{error:'No autorizado'}); finishQuestion(s); return sendJson(res,200,{ok:true});
    }
    if (req.method === 'GET' && p === '/api/session') {
      const code=u.searchParams.get('code'); const s=sessions.get(String(code||'')); if(!s) return sendJson(res,404,{error:'Sesión no encontrada'});
      return sendJson(res,200,{session:publicSession(s,u.searchParams.get('playerId'))});
    }
    if (req.method === 'GET' && p === '/events') {
      const code=u.searchParams.get('code'); const s=sessions.get(String(code||'')); if(!s){res.writeHead(404);return res.end();}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'}); res.write('retry: 1500\n\n');
      const client={res,playerId:u.searchParams.get('playerId')||null}; if(!sseClients.has(code)) sseClients.set(code,new Set()); sseClients.get(code).add(client);
      res.write(`data: ${JSON.stringify(publicSession(s,client.playerId))}\n\n`);
      req.on('close',()=>sseClients.get(code)?.delete(client)); return;
    }
    if (req.method === 'GET' && p.startsWith('/api/qr/')) {
      const code=p.split('/').pop(); const s=sessions.get(code); if(!s) return sendJson(res,404,{error:'Sesión no encontrada'});
      const proto=req.headers['x-forwarded-proto']||'http'; const host=req.headers.host||`localhost:${PORT}`; const payload=`${proto}://${host}/play?code=${code}`;
      const py=spawn('python3',[path.join(ROOT,'scripts','make_qr.py'),payload]); res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'}); py.stdout.pipe(res); py.stderr.on('data',()=>{}); py.on('error',()=>res.end()); return;
    }
    if (req.method === 'GET' && (p==='/'||p==='/admin')) return serveFile(res,path.join(PUBLIC,'admin.html'));
    if (req.method === 'GET' && p==='/presenter') return serveFile(res,path.join(PUBLIC,'presenter.html'));
    if (req.method === 'GET' && p==='/preview') return serveFile(res,path.join(PUBLIC,'preview.html'));
    if (req.method === 'GET' && p==='/play') return serveFile(res,path.join(PUBLIC,'player.html'));
    if (req.method === 'GET') return serveFile(res,path.join(PUBLIC,p.replace(/^\//,'')));
    return sendJson(res,404,{error:'not found'});
  } catch(e) { console.error(e); return sendJson(res,500,{error:'Error interno',detail:String(e.message||e)}); }
});
server.listen(PORT,HOST,()=>console.log(`G IOTK activa en http://localhost:${PORT}`));
