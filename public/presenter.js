const params=new URLSearchParams(location.search),code=params.get('code'),token=params.get('token');
const screen=document.querySelector('#screen');
let state=null,musicOn=params.get('music')!=='0'&&localStorage.getItem('giotk-music')!=='off',lastAudioState='',soundUnlocked=false;
let musicVolume=Math.max(1,Math.min(4,Number(params.get('volume')||localStorage.getItem('giotk-volume')||3)));
localStorage.setItem('giotk-music',musicOn?'on':'off');localStorage.setItem('giotk-volume',String(musicVolume));
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));

class GAudio{
  constructor(){this.ctx=null;this.timer=null;this.noise=null;this.mode='';this.master=null;this.comp=null;}
  ensure(){if(!this.ctx){this.ctx=new (window.AudioContext||window.webkitAudioContext)();this.master=this.ctx.createGain();this.comp=this.ctx.createDynamicsCompressor();this.comp.threshold.value=-18;this.comp.knee.value=18;this.comp.ratio.value=5;this.comp.attack.value=.003;this.comp.release.value=.18;this.master.gain.value=2.2;this.master.connect(this.comp).connect(this.ctx.destination);}if(this.ctx.state==='suspended')this.ctx.resume().catch(()=>{});}
  stop(){if(this.timer){clearInterval(this.timer);this.timer=null;}this.mode='';}
  tone(freq=440,d=.12,vol=.025,type='sine',when=0){
    this.ensure();const t=this.ctx.currentTime+when,o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(Math.max(.0001,vol*musicVolume),t);g.gain.exponentialRampToValueAtTime(.0001,t+d);
    o.connect(g).connect(this.master);o.start(t);o.stop(t+d+.04);
  }
  hit(freq=110,d=.09,vol=.05,when=0){this.tone(freq,d,vol,'triangle',when);this.tone(freq*1.7,d*.55,vol*.35,'square',when);}
  shaker(when=0,vol=.015){
    this.ensure();const len=Math.floor(this.ctx.sampleRate*.055),buf=this.ctx.createBuffer(1,len,this.ctx.sampleRate),data=buf.getChannelData(0);
    for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);
    const src=this.ctx.createBufferSource(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();f.type='highpass';f.frequency.value=4500;g.gain.value=vol*musicVolume;src.buffer=buf;src.connect(f).connect(g).connect(this.master);src.start(this.ctx.currentTime+when);
  }
  set(mode){if(!musicOn){this.stop();return;}if(this.mode===mode)return;this.stop();this.ensure();this.mode=mode;
    if(mode==='lobby')this.lobby();else if(mode==='result')this.review();else if(mode==='podium')this.podium();
  }
  lobby(){
    let step=0;const seq=[261.63,329.63,392,329.63,293.66,349.23,440,349.23];
    const play=()=>{if(this.mode!=='lobby')return;const s=step++%16;if([0,4,8,12].includes(s))this.hit(s===0?100:125,.11,.075);if([2,6,10,14].includes(s))this.hit(210,.06,.045);this.shaker(0,.025);if(s%2===0)this.tone(seq[(s/2)%seq.length],.16,.035,'triangle');};
    play();this.timer=setInterval(play,170);
  }
  review(){
    let step=0;const chords=[[261.63,329.63,392],[220,277.18,329.63],[246.94,311.13,369.99],[196,246.94,293.66]];
    const play=()=>{if(this.mode!=='result')return;const c=chords[step++%chords.length];c.forEach((f,i)=>this.tone(f,.7,.018,'sine',i*.04));this.tone(c[0]*2,.28,.02,'triangle',.15);};
    play();this.timer=setInterval(play,900);
  }
  podium(){
    let step=0,roll=0;const start=Date.now();
    const play=()=>{if(this.mode!=='podium')return;const age=Date.now()-start;if(age<2600){roll++;this.hit(105+roll%3*10,.055,.065);if(roll%2===0)this.shaker(0,.035);}else{const s=step++%16;if([0,4,8,12].includes(s))this.hit(90,.12,.095);if([2,6,10,14].includes(s))this.hit(180,.07,.065);this.shaker(0,.04);if([0,3,6,8,11,14].includes(s))this.tone([523.25,659.25,783.99,1046.5][s%4],.22,.045,'square');}};
    play();this.timer=setInterval(play,120);
  }
}
const audioEngine=new GAudio();

function setAudioForState(s){const mode=s==='lobby'?'lobby':s==='result'?'result':s==='finished'?'podium':'';if(lastAudioState!==mode){lastAudioState=mode;if(mode&&soundUnlocked)audioEngine.set(mode);else if(!mode)audioEngine.stop();}}
function unlockSound(){soundUnlocked=true;audioEngine.ensure();if(state)setAudioForState(state.state),audioEngine.set(lastAudioState);document.querySelector('#soundGate')?.remove();}
function showSoundGate(){if(soundUnlocked||document.querySelector('#soundGate'))return;const gate=document.createElement('div');gate.id='soundGate';gate.className='sound-gate';gate.innerHTML=`<div class="sound-card"><h2>🎵 Sonido de G IOTK</h2><p>Activa el audio para escuchar la música de espera, revisión y podio.</p><button id="unlockSound" class="btn good">▶ Activar música</button><div class="sound-note">Los navegadores requieren una interacción para habilitar el sonido.</div></div>`;document.body.appendChild(gate);document.querySelector('#unlockSound').onclick=unlockSound;}

async function action(path){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,token})});const d=await r.json();if(!r.ok)alert(d.error||'Error')}
function podium(r){const a=r.slice(0,3);return `<div class="celebrate">🎉</div><div class="big">🏆 Podio final</div><div class="podium">${a[1]?`<div class="pod p2">🥈<br>${esc(a[1].name)}<br><span class="muted">${a[1].score} pts</span></div>`:''}${a[0]?`<div class="pod p1">🥇<br>${esc(a[0].name)}<br><span>${a[0].score} pts</span></div>`:''}${a[2]?`<div class="pod p3">🥉<br>${esc(a[2].name)}<br><span class="muted">${a[2].score} pts</span></div>`:''}</div>`}
function render(s){
  state=s;screen.classList.toggle('question-active',s.state==='question');const quizBadge=document.querySelector('#presenterQuizBadge');if(quizBadge)quizBadge.textContent=s.quizTitle||'';if(musicOn&&!soundUnlocked)showSoundGate();setAudioForState(s.state);
  if(s.state==='lobby'){
    const joinUrl=`${location.origin}/play`;
    screen.innerHTML=`<div class="lobby-grid"><div class="qr-column"><h1 class="lobby-title">Game IOTK</h1><img class="qr" src="/api/qr/${code}" alt="Código QR de acceso"><h3 class="connected-count">${s.joinedCount} jugador${s.joinedCount===1?'':'es'} conectado${s.joinedCount===1?'':'s'}</h3></div><div class="join-details"><div class="code">${code}</div><p class="muted">Si no puedes leer el QR, ingresa a:</p><div class="join-url">${esc(joinUrl)}</div><p class="muted">y escribe el código de acceso.</p></div></div><div class="lobby-actions"><a href="/admin" class="btn alt" style="text-decoration:none">Administración</a><button id="next" class="btn good" ${s.joinedCount<1?'disabled':''}>Iniciar primera pregunta</button></div>`;
    document.querySelector('#next').onclick=()=>action('/api/presenter/next');
  } else if(s.state==='question'){
    const q=s.question,layout=q.layout||{},textSize=Math.max(24,Math.min(64,Number(layout.textSize||42))),imageSize=Math.max(20,Math.min(48,Number(layout.imageSize||34))),answerPos=['bottom','row','right'].includes(layout.answersPosition)?layout.answersPosition:'bottom';screen.style.setProperty('--q-font',`${textSize}px`);screen.style.setProperty('--image-col',`${imageSize}%`);screen.innerHTML=`<div class="badge">Pregunta ${s.currentQuestion+1} de ${s.totalQuestions}</div><div class="question-stage ${q.image?'has-image':''}">${q.image?`<div class="question-media"><img src="${q.image}" alt="Imagen de apoyo de la pregunta"></div>`:''}<div class="question-content ${answerPos==='right'?'answers-right':''}"><div class="question-copy"><h1 class="big question-title">${esc(q.text)}</h1><div class="timer"><div id="bar"></div></div><div id="secs" class="big timer-number">${Math.ceil(s.remainingMs/1000)}</div></div><div class="answers ${answerPos==='row'?'answers-row':''}">${q.type==='text'?'<div class="answer">Respuesta libre desde cada dispositivo</div>':q.options.map((x,i)=>`<div class="answer option-${String.fromCharCode(97+i)}">${String.fromCharCode(65+i)} · ${esc(x)}</div>`).join('')}</div></div></div><div class="question-footer"><p class="muted">Respuestas recibidas en tiempo real · ${s.joinedCount} jugadores</p><button id="end" class="btn danger">Terminar pregunta ahora</button></div>`;document.querySelector('#end').onclick=()=>action('/api/presenter/end-question');tick();
  } else if(s.state==='result'){
    const r=s.result,qidx=s.currentQuestion,w=r.winner;
    screen.innerHTML=`<div class="badge">Resultado · Pregunta ${qidx+1}</div><h1>${w?`⚡ ${esc(w.name)} fue el más rápido`:'Sin ganador en esta pregunta'}</h1><div class="correct-answer"><div class="correct-kicker">RESPUESTA CORRECTA</div><div class="correct-main">${esc(r.correctDisplay||'')}</div></div><h3>Ranking</h3><div class="ranking-box">${s.ranking.slice(0,10).map((p,i)=>`<div class="rank"><span>${i+1}. ${esc(p.name)}</span><b>${p.score} pts</b></div>`).join('')}</div><button id="next" class="btn good">${qidx+1>=s.totalQuestions?'Ver podio final':'Siguiente pregunta'}</button>`;document.querySelector('#next').onclick=()=>action('/api/presenter/next');
  } else if(s.state==='finished'){
    screen.innerHTML=podium(s.ranking)+`<p><a href="/admin" class="btn good" style="text-decoration:none">Volver a administración</a></p>`;
  }
}
function tick(){if(state?.state!=='question')return;const left=Math.max(0,state.questionEndsAt-Date.now()),dur=(state.question?.duration||20)*1000;const b=document.querySelector('#bar'),x=document.querySelector('#secs');if(b)b.style.width=`${left/dur*100}%`;if(x)x.textContent=Math.ceil(left/1000);if(left>0)requestAnimationFrame(tick)}
if(!code||!token)screen.innerHTML='<h2>Sesión no válida</h2>';else{const es=new EventSource(`/events?code=${encodeURIComponent(code)}`);es.onmessage=e=>render(JSON.parse(e.data));}
