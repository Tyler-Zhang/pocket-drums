'use strict';
const $ = id => document.getElementById(id);
const voices = [
  {name:'Crash',short:'CR',notes:[49,52,55,57],y:30,cymbal:true},
  {name:'Ride',short:'RD',notes:[51,53,59],y:40,cymbal:true},
  {name:'Hi-hat',short:'HH',notes:[42,44,46,22,26],y:50,cymbal:true},
  {name:'High tom',short:'T1',notes:[48,50],y:60},
  {name:'Snare',short:'SD',notes:[38,40,37],y:70},
  {name:'Low tom',short:'T2',notes:[45,47],y:80},
  {name:'Floor tom',short:'FT',notes:[41,43],y:90},
  {name:'Kick',short:'BD',notes:[35,36],y:100}
];
let pattern = Array.from({length:4},()=>voices.map(()=>Array(16).fill(false)));
let barCount=1, editBar=0, bpm=90, mode='trainer', running=false, hits=[], midi;
let audio, noiseBuffer, timer, nextStep, nextTime, startAudio, startPerformance, sessionBpm, scheduled=[];
let taps=[];
let appTempo = 90;
let preferredView = 'trainer';
let calibration = null;
let preferredMidiInput = '';
try { preferredMidiInput = localStorage.getItem('pocket-midi-input') || ''; } catch {}
const midiClock = new MidiClock();
let syncArmed = false;
let syncWatchdog;
let frameId;
const followsMidi = () => $('clockSource').value === 'midi';

function updateStartButton() {
  $('start').textContent = syncArmed ? 'Disarm MIDI sync' :
    running ? 'Stop' : followsMidi() ? 'Arm MIDI sync' :
    mode === 'trainer' ? 'Start practice' : 'Play groove';
}

function updateSyncStatus(message) {
  $('syncStatus').textContent = message;
}

function stopAudio() {
  cancelAnimationFrame(frameId);
  clearInterval(timer);
  for (const node of scheduled) {
    try { node.stop(); } catch {}
  }
  scheduled = [];
}

function pauseMidi(message) {
  running = false;
  midiClock.stop();
  stopAudio();
  document.querySelectorAll('.playing').forEach(element => element.classList.remove('playing'));
  updateSyncStatus(message);
  $('position').textContent = message;
  updateStartButton();
}

async function armMidi() {
  if (!$('devices').value) {
    updateSyncStatus('Connect MIDI and choose the V51 input first.');
    return;
  }
  try {
    await initAudio();
    if (mode === 'trainer') resetHits();
    midiClock.reset();
    midiClock.start();
    sessionBpm = bpm;
    syncArmed = true;
    running = false;
    updateSyncStatus('Armed - waiting for MIDI clock. Start on the V51 to align bar 1.');
    updateStartButton();
    syncWatchdog = setInterval(() => {
      if (running && !midiClock.isFresh(performance.now())) {
        pauseMidi('Clock lost - stopped. Re-arm or send MIDI Start to resume.');
      }
    }, 100);
  } catch (error) {
    updateSyncStatus(`Audio unavailable - ${error.message}`);
  }
}

function handleMidiSync(event) {
  const [status, low, high] = event.data;
  if (!followsMidi()) return;
  if (status === 0xf8) {
    const pulse = midiClock.tick(event.timeStamp);
    if (midiClock.bpm) {
      bpm = midiClock.bpm;
      sessionBpm = bpm;
      $('tempo').value = Math.round(midiClock.bpm);
      $('tempoSlider').value = Math.max(30, Math.min(260, bpm));
    }
    if (!syncArmed) {
      updateSyncStatus('MIDI clock detected - tap Arm MIDI sync to follow.');
      return;
    }
    if (!pulse) return;
    if (!running) {
      running = true;
      frameId = requestAnimationFrame(frame);
    }
    updateSyncStatus(`Following MIDI clock - ${midiClock.bpm ? Math.round(midiClock.bpm) : '...'} BPM`);
    if (pulse.number % 6 !== 0) return;
    const step = pulse.number / 6;
    const time = audio.currentTime + Math.max(0, (event.timeStamp - performance.now()) / 1000);
    if (mode === 'playground') {
      const position = step % (barCount * 16);
      pattern[Math.floor(position / 16)].forEach((row, index) => {
        if (row[position % 16]) drum(index, time);
      });
    }
    return;
  }
  if (!syncArmed) return;
  if (status === 0xfa) {
    pauseMidi('MIDI Start - waiting for clock');
    if (mode === 'trainer') resetHits();
    midiClock.start();
  } else if (status === 0xfb) {
    midiClock.resume();
    updateSyncStatus('MIDI Continue - waiting for clock');
  } else if (status === 0xfc) {
    pauseMidi('MIDI stopped - waiting for Start or Continue');
  } else if (status === 0xf2 && event.data.length >= 3) {
    midiClock.seek(low | (high << 7));
  }
}

$('clockSource').onchange = () => {
  stop();
  midiClock.reset();
  for (const id of ['tempo', 'tempoSlider', 'tap', 'click']) $(id).disabled = followsMidi();
  updateSyncStatus(followsMidi() ? 'Connect MIDI, then arm sync to follow the V51.' : 'App tempo is in control.');
  if (!followsMidi()) setTempo(appTempo);
  save();
  updateStartButton();
};

function save() {
  try {
    localStorage.setItem('pocket-v1', JSON.stringify({
      pattern, barCount, editBar, bpm: appTempo,
      clockSource: $('clockSource').value,
      click: $('click').checked,
      offset: Number($('offset').value),
      preset: $('preset').value,
      view: mode
    }));
    $('saved').textContent = 'Saved on this device';
  } catch {
    $('saved').textContent = 'Storage unavailable';
  }
}
function preset(type){pattern=Array.from({length:4},()=>voices.map(()=>Array(16).fill(false)));if(type!=='empty')for(let b=0;b<4;b++){for(let s=0;s<16;s++){pattern[b][2][s]=s%(type==='funk'?1:2)===0;pattern[b][4][s]=s===4||s===12;pattern[b][7][s]=[0,8,...(type==='funk'?[7,10]:[])].includes(s);}}}
preset('basic');
try {
  const saved = JSON.parse(localStorage.getItem('pocket-v1'));
  if (saved) {
    if (Number.isFinite(saved.offset)) $('offset').value = Math.max(-500, Math.min(500, saved.offset));
    if (Number.isFinite(saved.bpm)) bpm = Math.max(30, Math.min(260, saved.bpm));
    appTempo = bpm;
    if (['internal', 'midi'].includes(saved.clockSource)) $('clockSource').value = saved.clockSource;
    if (typeof saved.click === 'boolean') $('click').checked = saved.click;
    if (['basic', 'funk', 'empty'].includes(saved.preset)) $('preset').value = saved.preset;
    if (['trainer', 'playground'].includes(saved.view)) preferredView = saved.view;
    if ([1, 2, 4].includes(saved.barCount)) barCount = saved.barCount;
    if (Number.isInteger(saved.editBar)) editBar = Math.max(0, Math.min(barCount - 1, saved.editBar));
    if (saved.pattern?.length === 4 && saved.pattern.every(bar => bar.length === 8 &&
      bar.every(row => row.length === 16 && row.every(value => typeof value === 'boolean')))) {
      pattern = saved.pattern;
    }
  }
} catch {}
function setTempo(value){if(running)stop();bpm=Math.max(30,Math.min(260,Math.round(Number(value)||90)));appTempo=bpm;$('tempo').value=bpm;$('tempoSlider').value=bpm;save();}
$('tempo').onchange=e=>setTempo(e.target.value);$('tempoSlider').oninput=e=>setTempo(e.target.value);
$('tap').onclick=()=>{const now=performance.now();if(taps.length&&now-taps.at(-1)>2000)taps=[];taps.push(now);taps=taps.slice(-7);if(taps.length>1)setTempo(60000/((now-taps[0])/(taps.length-1)));$('tap').textContent=`Tap tempo · ${taps.length}`;};
async function initAudio(){audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();if(!noiseBuffer){noiseBuffer=audio.createBuffer(1,audio.sampleRate,audio.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;}$('audioStatus').textContent='Audio ready · use wired headphones for timing';}
function tone(time,freq,duration,volume,endFreq){const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.setValueAtTime(freq,time);if(endFreq)osc.frequency.exponentialRampToValueAtTime(endFreq,time+duration);gain.gain.setValueAtTime(volume,time);gain.gain.exponentialRampToValueAtTime(.001,time+duration);osc.connect(gain).connect(audio.destination);osc.start(time);osc.stop(time+duration);scheduled.push(osc);osc.onended=()=>{scheduled=scheduled.filter(n=>n!==osc);gain.disconnect();};}
function noise(time,duration,freq,volume){const src=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();src.buffer=noiseBuffer;filter.type='highpass';filter.frequency.value=freq;gain.gain.setValueAtTime(volume,time);gain.gain.exponentialRampToValueAtTime(.001,time+duration);src.connect(filter).connect(gain).connect(audio.destination);src.start(time);src.stop(time+duration);scheduled.push(src);src.onended=()=>{scheduled=scheduled.filter(n=>n!==src);gain.disconnect();};}
function drum(row,time){if(row===7)tone(time,150,.18,.65,42);else if(row===4){noise(time,.15,1000,.32);tone(time,180,.08,.15,80);}else if(voices[row].cymbal)noise(time,row===0?.7:row===1?.28:.07,5500,row===0?.15:.12);else tone(time,220-(row-3)*30,.22,.36,70);}
function scheduler(){if(!running)return;while(nextTime<audio.currentTime+.12){if(nextTime<audio.currentTime-.04){stop();$('position').textContent='Audio paused. Start again to resume.';return;}const step=nextStep;if($('click').checked&&step%4===0)tone(nextTime,step%16===0?1500:950,.035,.15);if(mode==='playground'){const s=step%(barCount*16);pattern[Math.floor(s/16)].forEach((row,r)=>{if(row[s%16])drum(r,nextTime);});}nextTime+=60/sessionBpm/4;nextStep++;}}
async function start(){try{await initAudio();if(mode==='trainer')resetHits();running=true;sessionBpm=bpm;startAudio=audio.currentTime+.15;startPerformance=performance.now()+(startAudio-audio.currentTime)*1000;nextTime=startAudio;nextStep=mode==='trainer'?-16:0; // negative steps provide the count-in
if(mode==='trainer')startPerformance+=16*60000/sessionBpm/4;
$('start').textContent='Stop';scheduler();timer=setInterval(scheduler,25);frameId = requestAnimationFrame(frame);}catch(e){stop();$('audioStatus').textContent=`Audio unavailable · ${e.message}`;}}
function stop() {
  if (calibration) {
    calibration = null;
    $('calibrate').textContent = 'Calibrate offset';
    $('calibrationStatus').textContent = 'Calibration cancelled. Your previous offset is still saved.';
  }
  running = false;
  syncArmed = false;
  clearInterval(syncWatchdog);
  midiClock.stop();
  stopAudio();
  if (followsMidi()) updateSyncStatus('Sync disarmed - tap Arm MIDI sync to follow.');
  updateStartButton();
  document.querySelectorAll('.playing').forEach(element => element.classList.remove('playing'));
}
$('start').onclick = () => {
  if (syncArmed || running) stop();
  else if (followsMidi()) armMidi();
  else start();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (running || syncArmed)) {
    stop();
    updateSyncStatus('Stopped while hidden - tap to start again.');
    $('audioStatus').textContent = 'Stopped while the page was hidden';
  }
});
function route(){stop();mode=location.hash==='#playground'||(!location.hash&&preferredView==='playground')?'playground':'trainer';preferredView=mode;save();$('trainer').hidden=mode!=='trainer';$('playground').hidden=mode!=='playground';$('title').textContent=mode==='trainer'?'Get into time.':'Make it groove.';$('subtitle').textContent=mode==='trainer'?'Connect your kit, follow the click, and see where every hit lands.':'A blank bar, a few hits, and a groove that’s yours.';document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+mode));$('start').textContent=mode==='trainer'?'Start practice':'Play groove';updateStartButton();draw();}
window.addEventListener('hashchange',route);
function resetHits(){hits=[];updateStats();draw();$('hitLog').replaceChildren();} $('reset').onclick=resetHits;
async function connect(){if(!navigator.requestMIDIAccess){$('midiStatus').textContent='Web MIDI is unavailable here. Open this HTTPS page in a supporting browser such as Chrome on your Mac.';return;}try{midi=await navigator.requestMIDIAccess({sysex:false});refreshInputs();midi.onstatechange=refreshInputs;}catch(e){$('midiStatus').textContent=`MIDI access failed · ${e.message}. Click Connect MIDI to grant access or retry.`;}}
function refreshInputs() {
  const inputs = [...midi.inputs.values()].filter(input => input.state === 'connected');
  const wanted = $('devices').value || preferredMidiInput;
  const selected = wanted ? inputs.find(input => input.id === wanted) : inputs[0];
  $('devices').replaceChildren(new Option('Choose MIDI input', ''),
    ...inputs.map(input => new Option(input.name || 'MIDI input', input.id)));
  $('devices').value = selected?.id || '';
  selectInput();
}

function selectInput() {
  stop();
  midiClock.reset();
  const selected = $('devices').value;
  if (selected) {
    preferredMidiInput = selected;
    try { localStorage.setItem('pocket-midi-input', selected); } catch {}
  }
  if (followsMidi()) updateSyncStatus('MIDI input changed - arm sync to follow.');
  for (const input of midi.inputs.values()) {
    input.onmidimessage = input.id === selected ? onMidi : null;
  }
  $('midiStatus').textContent = selected ? 'Connected - play your kit' :
    preferredMidiInput ? 'Last MIDI input is unavailable. Reconnect it or choose another input.' :
    'No input selected - connect your kit and choose an input';
}
$('connect').onclick=connect;$('devices').onchange=selectInput;
function onMidi(event){handleMidiSync(event);const [status,note,velocity]=event.data;if((status&240)!==144||!velocity)return;const voice=voices.find(v=>v.notes.includes(note));const name=voice?.name||`Note ${note}`;$('noteStatus').textContent=`${name} · MIDI ${note} · velocity ${velocity}`;if(!running||mode!=='trainer')return;if(calibration){recordCalibration(event.timeStamp,note);return;}const timestamp = event.timeStamp - Math.max(-500,Math.min(500,Number($('offset').value)||0));
let timing;
if (followsMidi()) {
  if (!midiClock.isFresh(event.timeStamp)) return;
  timing = midiClock.timingAt(timestamp);
} else {
  const time = timestamp - startPerformance;
  if (time < 0) return;
  const stepDuration = 60000 / sessionBpm / 4;
  const step = Math.round(time / stepDuration);
  timing = { step, error: time - step * stepDuration };
}
if (!timing) return;
const { step, error } = timing;hits.push({step,error,note,name,velocity});if(hits.length>10000)hits.shift();const tag=document.createElement('span');tag.textContent=`${voices[7].notes.includes(note) ? "\u25c6 " : ""}${name} ${error>0?'+':''}${Math.round(error)} ms`;$('hitLog').prepend(tag);while($('hitLog').children.length>8)$('hitLog').lastChild.remove();updateStats();draw();}
function updateStats(){$('hitCount').textContent=hits.length;$('mean').textContent=hits.length?`${Math.round(hits.reduce((a,h)=>a+Math.abs(h.error),0)/hits.length)} ms`:'—';$('accuracy').textContent=hits.length?`${Math.round(100*hits.filter(h=>Math.abs(h.error)<=25).length/hits.length)}%`:'—';const last=hits.at(-1);$('last').textContent=last?`${last.error>0?'+':''}${Math.round(last.error)} ms`:'—';}
function draw(){if(mode!=='trainer')return;const canvas=$('timing'),rect=canvas.getBoundingClientRect();if(!rect.width)return;const dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);const w=rect.width,h=rect.height,left=48,right=w-12,top=30,bottom=h-30,mid=(top+bottom)/2,range=60000/(running?sessionBpm:bpm)/8;const current=running?(followsMidi()?Math.max(0,midiClock.positionAt(performance.now())||0):Math.max(0,(performance.now()-startPerformance)/(60000/sessionBpm/4))):hits.at(-1)?.step||0;const first=Math.max(0,Math.floor(current/16)*16-48);c.font='11px sans-serif';for(let s=0;s<=64;s++){const x=left+(right-left)*s/64;c.strokeStyle=s%16===0?'#64745c':s%4===0?'#3c4c3d':'#28372d';c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();if(s%16===0&&s<64){c.fillStyle='#a4b3a5';c.fillText(`Bar ${Math.floor((first+s)/16)+1}`,x+4,16);}}const tolerance=25/range*(bottom-top)/2;c.fillStyle='#c6ec8710';c.fillRect(left,mid-tolerance,right-left,tolerance*2);for(const value of [-range,0,range]){const y=mid+value/range*(bottom-top)/2;c.strokeStyle=value===0?'#c6ec87':'#344238';c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.fillStyle='#a4b3a5';c.fillText(value===0?'0':`${Math.round(value)}`,2,y+4);}for(const hit of hits){if(hit.step<first||hit.step>=first+64)continue;const x=left+(hit.step-first+hit.error/(range*2))/64*(right-left),y=mid+hit.error/range*(bottom-top)/2;c.fillStyle=Math.abs(hit.error)<=25?'#c6ec87':'#efab72';c.beginPath();if(voices[7].notes.includes(hit.note)){c.moveTo(x,y-6);c.lineTo(x+6,y);c.lineTo(x,y+6);c.lineTo(x-6,y);c.closePath();}else{c.arc(x,y,4,0,Math.PI*2);}c.fill();}if(running&&current>=first){const x=left+(current-first)/64*(right-left);c.strokeStyle='#eef1e6';c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();}}
function frame() {
  if (!running) return;
  const elapsed = followsMidi() ? Math.max(0, midiClock.positionAt(performance.now()) || 0) :
    (audio.currentTime - startAudio) / (60 / sessionBpm / 4);
  if (mode === 'trainer') {
    const position = followsMidi() ? elapsed : elapsed - 16;
    $('position').textContent = position < 0 ?
      `Count in - ${Math.max(1, 4 - Math.floor(Math.max(0, elapsed) / 4))}` :
      `Bar ${Math.floor(position / 16) + 1} ? beat ${Math.floor(position % 16 / 4) + 1}`;
    draw();
  } else {
    const step = Math.max(0, Math.floor(elapsed)) % (barCount * 16);
    document.querySelectorAll('.step').forEach(element => {
      element.classList.toggle('playing', Number(element.dataset.step) === step % 16 &&
        editBar === Math.floor(step / 16));
    });
  }
  frameId = requestAnimationFrame(frame);
}
function renderEditor(){$('bars').value=barCount;$('editBar').replaceChildren(...Array.from({length:barCount},(_,b)=>new Option(String(b+1),String(b))));$('editBar').value=editBar;const container=$('sequencer');container.replaceChildren();const counts=document.createElement('div');counts.className='stepRow counts';for(const text of ['KIT',...Array.from({length:16},(_,s)=>s%4===0?String(s/4+1):['','e','&','a'][s%4])]){const label=document.createElement('span');label.textContent=text;counts.append(label);}container.append(counts);voices.forEach((voice,r)=>{const row=document.createElement('div');row.className='stepRow';const name=document.createElement('span');name.textContent=voice.name;row.append(name);for(let s=0;s<16;s++){const button=document.createElement('button');button.className='step'+(s%4===0?' beat':'');button.dataset.step=s;button.setAttribute('aria-label',`${voice.name}, bar ${editBar+1}, beat ${Math.floor(s/4)+1} ${['','e','and','a'][s%4]}`);button.setAttribute('aria-pressed',pattern[editBar][r][s]);button.textContent=pattern[editBar][r][s]?(r===7?'\u25c6':'\u25cf'):'';button.onclick=async()=>{pattern[editBar][r][s]=!pattern[editBar][r][s];button.setAttribute('aria-pressed',pattern[editBar][r][s]);button.textContent=pattern[editBar][r][s]?(r===7?'\u25c6':'\u25cf'):'';save();renderScore();if(pattern[editBar][r][s]&&!running){try{await initAudio();drum(r,audio.currentTime);}catch(e){$('audioStatus').textContent=e.message;}}};row.append(button);}container.append(row);});renderScore();}
function renderScore(){const ns='http://www.w3.org/2000/svg';$('notation').replaceChildren();for(let b=0;b<barCount;b++){const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 160');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Bar ${b+1} drum score`);function el(type,attrs,text){const node=document.createElementNS(ns,type);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);if(text)node.textContent=text;svg.append(node);return node;}el('text',{x:12,y:20,'font-size':12,fill:'#52614d'},`Bar ${b+1} · 4/4`);for(let y=50;y<=90;y+=10)el('line',{x1:55,x2:880,y1:y,y2:y,stroke:'#7f8c76','stroke-width':.7});voices.forEach(v=>el('text',{x:25,y:v.y+4,'font-size':9,fill:'#53614d'},v.short));for(let s=0;s<16;s++){const x=75+s*50;el('text',{x:x-3,y:148,'font-size':11,fill:'#53614d'},s%4===0?String(s/4+1):['','e','&','a'][s%4]);const active=pattern[b].map((row,r)=>row[s]?r:-1).filter(r=>r>=0);if(!active.length){el('text',{x:x-3,y:76,'font-size':17,fill:'#7f8c76'},'𝄿');continue;}const minY=Math.min(...active.map(r=>voices[r].y));for(const r of active){const v=voices[r];if(v.cymbal){el('path',{d:`M${x-4} ${v.y-4}l8 8m0-8l-8 8`,stroke:'#15251b','stroke-width':1.8});}else el('ellipse',{cx:x,cy:v.y,rx:5,ry:3.5,fill:'#15251b',transform:`rotate(-20 ${x} ${v.y})`});}el('line',{x1:x+4,x2:x+4,y1:Math.max(...active.map(r=>voices[r].y)),y2:minY-23,stroke:'#15251b','stroke-width':1.5});for(let flag=0;flag<2;flag++)el('path',{d:`M${x+4} ${minY-23+flag*6}q12 4 8 13`,fill:'none',stroke:'#15251b','stroke-width':1.7});}for(const x of [55,880])el('line',{x1:x,x2:x,y1:50,y2:100,stroke:'#15251b'});$('notation').append(svg);}}
$('bars').onchange=e=>{stop();barCount=Number(e.target.value);editBar=Math.min(editBar,barCount-1);save();renderEditor();};$('editBar').onchange=e=>{editBar=Number(e.target.value);save();renderEditor();};$('clearBar').onclick=()=>{pattern[editBar]=voices.map(()=>Array(16).fill(false));save();renderEditor();};$('load').onclick=()=>{stop();preset($('preset').value);save();renderEditor();};
window.addEventListener('resize',draw);
$('tempo').value = bpm;
$('tempoSlider').value = bpm;
for (const id of ['tempo', 'tempoSlider', 'tap', 'click']) $(id).disabled = followsMidi();
if (followsMidi()) updateSyncStatus('Connect MIDI, then arm sync to follow the V51.');
renderEditor();
route();
$('click').onchange = save;
$('preset').onchange = save;
window.addEventListener('pagehide', save);

$('offset').onchange = () => {
  $('offset').value = Math.max(-500, Math.min(500, Number($('offset').value) || 0));
  save();
};

$('calibrate').onclick = async () => {
  if (calibration) {
    stop();
    return;
  }
  if (!$('devices').value) {
    $('calibrationStatus').textContent = 'Connect MIDI and select your drum kit first.';
    return;
  }
  stop();
  $('clockSource').value = 'internal';
  $('clockSource').onchange();
  $('click').checked = true;
  $('calibrate').disabled = true;
  await start();
  $('calibrate').disabled = false;
  if (!running) return;
  calibration = { errors: [], lastBeat: -1, note: null };
  $('calibrate').textContent = 'Cancel calibration';
  $('calibrationStatus').textContent = 'Count in for 4 beats, then play one pad on every quarter-note click: 1, 2, 3, 4. Keep using that pad. 0 / 24 hits';
};

function recordCalibration(timestamp, note) {
  const elapsed = timestamp - startPerformance;
  if (elapsed < 0) return;
  const beatDuration = 60000 / sessionBpm;
  const beat = Math.round(elapsed / beatDuration);
  if (beat <= calibration.lastBeat) return;
  if (calibration.note !== null && calibration.note !== note) return;
  calibration.note = note;
  calibration.lastBeat = beat;
  calibration.errors.push(elapsed - beat * beatDuration);
  $('calibrationStatus').textContent = `Play on each quarter-note click. ${calibration.errors.length} / 24 hits`;
  if (calibration.errors.length < 24) return;
  const result = estimateOffset(calibration.errors);
  calibration = null;
  stop();
  $('calibrate').textContent = 'Calibrate offset';
  if (!result.consistent || Math.abs(result.offset) > 500) {
    $('calibrationStatus').textContent = 'The hits varied too much to calibrate reliably. Try again at a comfortable tempo, using one pad on each click.';
    return;
  }
  $('offset').value = result.offset;
  save();
  $('calibrationStatus').textContent = `Offset saved: ${result.offset > 0 ? '+' : ''}${result.offset} ms. Typical variation: ${result.spread} ms. This estimate includes your playing tendency. Repeat to check it.`;
}

if (navigator.requestMIDIAccess) connect();
