// Moodle (opsional): status, tugas, dan sinkron berkala. Semuanya mati sampai pengguna menyalakannya di Pengaturan.
// Tugas yang belum dikumpulkan masuk ke kalender (dan lewat agenda, ke Notch) lengkap dengan pengingatnya.

import { EMPTY_STATUS, moodleApi, type MoodleItem, type MoodleStatus } from "$lib/moodle/api";

const SYNC_MS = 15 * 60_000;
const REMIND_KEY = "cognify.moodle.remind";

/** Pilihan pengingat tenggat (menit sebelum tenggat); null = tanpa pengingat. */
export const REMIND_CHOICES: { value: number | null; id: string; en: string }[] = [
  { value: null, id: "Tanpa pengingat", en: "No reminder" },
  { value: 60, id: "1 jam sebelumnya", en: "1 hour before" },
  { value: 180, id: "3 jam sebelumnya", en: "3 hours before" },
  { value: 1440, id: "1 hari sebelumnya", en: "1 day before" },
  { value: 2880, id: "2 hari sebelumnya", en: "2 days before" },
];

function loadRemind(): number | null {
  try {
    const raw = localStorage.getItem(REMIND_KEY);
    if (raw === null) return 1440;
    if (raw === "none") return null;
    const n = Number(raw);
    return REMIND_CHOICES.some((c) => c.value === n) ? n : 1440;
  } catch {
    return 1440;
  }
}

class MoodleStore {
  status = $state<MoodleStatus>(EMPTY_STATUS);
  items = $state<MoodleItem[]>([]);
  busy = $state(false);
  error = $state<string | null>(null);
  remindMin = $state<number | null>(loadRemind());

  #started = false;

  get active() {
    return this.status.enabled && this.status.connected;
  }

  async init() {
    if (this.#started) return;
    this.#started = true;
    await this.#reload();
    if (this.active) {
      void this.sync();
      void moodleApi.resume().catch(() => {}); // lanjutkan unduhan materi yang terputus
    }
    setInterval(() => {
      if (this.active) void this.sync();
    }, SYNC_MS);
  }

  async #reload() {
    try {
      this.status = await moodleApi.status();
      this.items = await moodleApi.items();
    } catch {
      /* fitur opsional: gagal memuat berarti tampil mati */
    }
  }

  async #run(job: () => Promise<MoodleStatus>) {
    this.busy = true;
    this.error = null;
    try {
      this.status = await job();
      this.items = await moodleApi.items();
      if (this.status.error) this.error = this.status.error;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Terjadi kesalahan.";
    } finally {
      this.busy = false;
    }
  }

  sync = () => this.#run(() => moodleApi.sync());
  connect = (baseUrl: string, username: string, password: string) => this.#run(() => moodleApi.connect(baseUrl, username, password));
  disconnect = () => this.#run(() => moodleApi.disconnect());
  async setEnabled(enabled: boolean) {
    await this.#run(() => moodleApi.setEnabled(enabled));
    if (enabled && this.status.connected) void this.sync();
  }

  setRemind(value: number | null) {
    this.remindMin = value;
    try {
      localStorage.setItem(REMIND_KEY, value === null ? "none" : String(value));
    } catch {
      /* hanya kenyamanan */
    }
  }
}

export const moodle = new MoodleStore();
