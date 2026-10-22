// Fisika ayunan catatan melayang. Kartu tergantung pada satu titik di tepi atasnya seperti bandul:
// saat jendela digeser, percepatan datar titik gantung memutar kartu ke arah berlawanan, lalu kartu
// berayun balik dan mereda. Murni (tanpa DOM) supaya bisa diuji.

export interface Swing {
  /** Sudut dalam radian; positif = searah jarum jam. */
  angle: number;
  /** Kecepatan sudut (rad/detik). */
  vel: number;
}

/** Sekitar 1,6 ayunan per detik: tidak terlalu lamban, tidak terlalu gesit. */
export const OMEGA = 2 * Math.PI * 1.6;
/** Redaman: kecil supaya sempat berayun beberapa kali sebelum diam. */
export const ZETA = 0.16;
/** Berapa radian/detik yang ditambahkan oleh tiap 1 px/detik perubahan kecepatan datar. */
export const GAIN = 0.0011;
/** Batas simpangan fisika (≈ 32°) supaya kartu tidak terbalik; yang tampil dibatasi lagi oleh `shown`. */
export const MAX_ANGLE = 0.56;
/** Mulai di sini ada "dinding" pegas yang makin keras, supaya sudut melambat dan berbalik mulus sebelum `MAX_ANGLE`. */
const SOFT_ANGLE = 0.38;
const WALL = OMEGA * OMEGA * 12;
const REST_ANGLE = 0.0008;
const REST_VEL = 0.004;

export const still = (): Swing => ({ angle: 0, vel: 0 });

/** Dorongan sesaat: kecepatan datar jendela berubah `dvx` px/detik (positif = makin ke kanan). */
export function push(s: Swing, dvx: number): Swing {
  return { angle: s.angle, vel: clampVel(s.vel + GAIN * dvx) };
}

/** Pembatas lembut (tanh), bukan potongan keras: dorongan besar tetap bertambah mulus. */
const clampVel = (v: number) => 14 * Math.tanh(v / 14);

/** Satu langkah waktu `dt` detik (semi-implicit Euler, dibagi dalam sub-langkah supaya stabil). */
export function step(s: Swing, dt: number): Swing {
  let { angle, vel } = s;
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = Math.min(dt, 0.1) / n;
  for (let i = 0; i < n; i++) {
    let acc = -OMEGA * OMEGA * angle - 2 * ZETA * OMEGA * vel;
    const over = Math.abs(angle) - SOFT_ANGLE;
    if (over > 0) acc -= Math.sign(angle) * WALL * over;
    vel += acc * h;
    angle += vel * h;
    if (angle > MAX_ANGLE) {
      angle = MAX_ANGLE;
      vel = Math.min(vel, 0) * 0.5; // membentur batas: memantul pelan
    } else if (angle < -MAX_ANGLE) {
      angle = -MAX_ANGLE;
      vel = Math.max(vel, 0) * 0.5;
    }
  }
  return { angle, vel };
}

export const atRest = (s: Swing): boolean => Math.abs(s.angle) < REST_ANGLE && Math.abs(s.vel) < REST_VEL;

/**
 * Sudut yang digambar: dipadatkan mulus (tanh) ke `limit` sehingga tidak pernah melewatinya dan tidak
 * ada pantulan keras di batas. `limit` berasal dari `safeAngle`.
 */
export const shown = (angle: number, limit: number): number => limit * Math.tanh(angle / limit);

/**
 * Sudut terbesar agar bagian bawah kartu yang berayun dari titik gantung di atas tetap muat di ruang
 * `room` px di sisi kartu: tinggi × sin(sudut) ≤ room.
 */
export const safeAngle = (height: number, room: number): number =>
  Math.min(MAX_ANGLE, Math.asin(Math.min(1, room / Math.max(height, 1))));
