let images = [];
let particles = [];
let targetPools = [];
let currentTargetIndex = 0;
let cycleTime = 0;

// ── 音频分析 ──────────────────────────────────────
let sound = null;
let fft, amplitude;
let audioReady = false;
let audioEnergy = 0;       // 平滑后的整体能量 0-1
let beatPower = 0;         // 节拍触发后衰减的峰值能量
let energyHistory = [];
const ENERGY_HISTORY_LEN = 43; // ~0.7s @60fps
// ─────────────────────────────────────────────────

const FLOW_DURATION = 140;
const HOLD_DURATION = 50;
const EXPLODE_DURATION = 70;
const TOTAL_CYCLE = FLOW_DURATION + HOLD_DURATION + EXPLODE_DURATION;

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 800;
const SCAN_STEP = 1;
const BRIGHTNESS_THRESHOLD = 50;
const MAX_PARTICLES = 20000;

// 5张图各自的爆炸强度配置（极弱→弱→中→强→极强），制造节奏层次
const EXPLOSION_PROFILES = [
  { minPower:  70, maxPower: 140, gravity: 10 },
  { minPower: 110, maxPower: 195, gravity: 17 },
  { minPower: 160, maxPower: 265, gravity: 26 },
  { minPower: 210, maxPower: 330, gravity: 34 },
  { minPower: 265, maxPower: 410, gravity: 44 }
];

class Particle {
  constructor() {
    this.x = random(0, width);
    this.y = random(height * 0.7, height);
    this.startX = this.x;
    this.startY = this.y;
    this.targetX = this.x;
    this.targetY = this.y;
    this.brightness = 30;
    this.explodeAngle = random(TWO_PI);
    this.explodePower = random(120, 240);
    this.explodeGravity = 24;
  }

  assignTarget(point, profile) {
    this.startX = this.x;
    this.startY = this.y;
    this.targetX = point.x;
    this.targetY = point.y;
    this.brightness = point.b;
    this.explodeAngle = random(TWO_PI);
    this.explodePower = random(profile.minPower, profile.maxPower);
    this.explodeGravity = profile.gravity;
  }

  // audioBoost：音乐节拍时放大爆炸距离（默认 1 无音乐）
  update(phase, audioBoost) {
    const boost = audioBoost || 1;

    if (phase < FLOW_DURATION) {
      const t = phase / FLOW_DURATION;
      const eased = t * t * (3 - 2 * t);
      const sway = sin((1 - eased) * PI * 2 + this.explodeAngle) * 2.5;
      this.x = lerp(this.startX, this.targetX, eased) + sway;
      this.y = lerp(this.startY, this.targetY, eased);
      return;
    }

    if (phase < FLOW_DURATION + HOLD_DURATION) {
      this.x = this.targetX;
      this.y = this.targetY;
      return;
    }

    const explodeT = (phase - FLOW_DURATION - HOLD_DURATION) / EXPLODE_DURATION;
    const easedExplode = 1 - pow(1 - explodeT, 2);
    this.x = this.targetX + cos(this.explodeAngle) * this.explodePower * easedExplode * boost;
    this.y =
      this.targetY +
      sin(this.explodeAngle) * this.explodePower * easedExplode * boost +
      this.explodeGravity * explodeT * explodeT;
  }

  display() {
    let grayValue;
    if (this.brightness < 17) {
      grayValue = 10;
    } else if (this.brightness < 34) {
      grayValue = 70;
    } else {
      grayValue = 140;
    }

    fill(grayValue);
    noStroke();
    circle(this.x, this.y, 1.5);
  }
}

function preload() {
  images = [
    loadImage('flower.jpg'),
    loadImage('flower2.jpg'),
    loadImage('flower3.jpg'),
    loadImage('flower4.jpg'),
    loadImage('flower5.jpg')
  ];
  // 加载音乐文件（需在项目文件夹放置 music.mp3 / music.ogg）
  soundFormats('mp3', 'ogg');
  sound = loadSound('music',
    () => {},                           // 成功：静默处理
    () => { sound = null; }             // 失败：关闭音乐模式，动画仍正常运行
  );
}

function setup() {
  createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);

  // 音频分析器（即使 sound 加载失败也安全初始化）
  fft = new p5.FFT(0.8, 256);
  amplitude = new p5.Amplitude();
  if (sound) amplitude.setInput(sound);

  targetPools = images.map((img) => extractTargetPool(img));

  const minPoolSize = min(...targetPools.map((pool) => pool.length));
  const particleCount = min(minPoolSize, MAX_PARTICLES);

  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle());
  }

  currentTargetIndex = floor(random(targetPools.length));
  applyTargetsFromPool(targetPools[currentTargetIndex], EXPLOSION_PROFILES[currentTargetIndex]);
}

function extractTargetPool(sourceImage) {
  const g = createGraphics(width, height);
  g.background(255);

  const scaleX = (width - 20) / sourceImage.width;
  const scaleY = (height - 20) / sourceImage.height;
  const scale = min(scaleX, scaleY);
  const scaledWidth = sourceImage.width * scale;
  const scaledHeight = sourceImage.height * scale;
  const offsetX = (width - scaledWidth) / 2;
  const offsetY = (height - scaledHeight) / 2;

  g.image(sourceImage, offsetX, offsetY, scaledWidth, scaledHeight);
  g.loadPixels();

  const points = [];
  for (let x = 0; x < width; x += SCAN_STEP) {
    for (let y = 0; y < height; y += SCAN_STEP) {
      const c = g.get(x, y);
      const b = brightness(c);
      if (b < BRIGHTNESS_THRESHOLD) {
        points.push({ x, y, b });
      }
    }
  }

  g.remove();
  return points;
}

function pickPoints(pool, count) {
  const selected = [];
  for (let i = 0; i < count; i++) {
    selected.push(pool[floor(random(pool.length))]);
  }
  return selected;
}

function applyTargetsFromPool(pool, profile) {
  const selectedTargets = pickPoints(pool, particles.length);
  for (let i = 0; i < particles.length; i++) {
    particles[i].assignTarget(selectedTargets[i], profile);
  }
}

function chooseNextTargetIndex() {
  if (targetPools.length <= 1) return 0;
  let next = currentTargetIndex;
  while (next === currentTargetIndex) {
    next = floor(random(targetPools.length));
  }
  return next;
}

// 节拍检测：当前能量显著超过近期滚动平均则判定为鼓点
function detectBeat(level) {
  energyHistory.push(level);
  if (energyHistory.length > ENERGY_HISTORY_LEN) energyHistory.shift();
  const avg = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
  return level > avg * 1.65 && level > 0.03;
}

// 点击画面：解锁浏览器音频并开始播放
function mousePressed() {
  if (!audioReady && sound) {
    userStartAudio();
    sound.loop();
    audioReady = true;
  }
}

function draw() {
  background(255);

  // ── 音频驱动爆炸增益 ──────────────────────────────
  let audioBoost = 1;
  if (audioReady && sound && sound.isPlaying()) {
    const level = amplitude.getLevel();
    audioEnergy = lerp(audioEnergy, min(level * 5, 1.0), 0.2);
    if (detectBeat(level)) {
      beatPower = 1.0;
    }
    beatPower = max(0, beatPower - 0.035);  // 节拍衰减
    audioBoost = 1 + beatPower * 2.5 + audioEnergy * 1.0;
  }
  // ─────────────────────────────────────────────────

  const phase = cycleTime % TOTAL_CYCLE;
  if (phase === 0 && cycleTime > 0) {
    currentTargetIndex = chooseNextTargetIndex();
    applyTargetsFromPool(targetPools[currentTargetIndex], EXPLOSION_PROFILES[currentTargetIndex]);
  }

  for (let i = 0; i < particles.length; i++) {
    particles[i].update(phase, audioBoost);
    particles[i].display();
  }

  // 未开始音乐时显示提示条
  if (!audioReady && sound) {
    noStroke();
    fill(0, 140);
    rect(0, height - 48, width, 48);
    fill(255);
    textSize(14);
    textAlign(CENTER, CENTER);
    text('✦  点击画面开始播放音乐  ✦', width / 2, height - 24);
  }

  cycleTime++;
}
