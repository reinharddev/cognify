// Klien Moodle (src-tauri/src/moodle.rs). Hanya jalan di app; di browser biasa fiturnya tidak tersedia.

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface MoodleStatus {
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  userName: string;
  fullName: string;
  siteName: string;
  lastSync: string | null;
  error: string | null;
  count: number;
}

export interface MoodleItem {
  id: string;
  course: string;
  title: string;
  /** Tenggat, UTC ISO-8601. */
  due: string;
  submitted: boolean;
  /** todo (belum), draft (konsep disimpan, sedang dikerjakan), submitted (dikumpulkan atau dinilai) */
  state: "todo" | "draft" | "submitted";
  url: string | null;
}

export interface MoodleCourse {
  id: number;
  name: string;
  files: number;
  saved: number;
}

export type FileState = "remote" | "queued" | "downloading" | "done" | "error";

export interface MoodleFile {
  id: string;
  courseId: number;
  section: string;
  module: string;
  filename: string;
  filepath: string;
  size: number;
  mime: string;
  modified: number;
  state: FileState;
  localPath: string | null;
  bytesDone: number;
  error: string | null;
}

export interface MoodleLink {
  id: string;
  courseId: number;
  section: string;
  module: string;
  /** page (teks halaman), embed (iframe di halaman), link (tautan biasa) */
  kind: "page" | "embed" | "link";
  title: string;
  url: string;
  provider: string;
  /** Alamat yang bisa dimuat di dalam Cognify (saat ini hanya Canva). */
  embedUrl: string | null;
  body: string;
}

/** Satu baris struktur course: ringkasan bagian (`section`) atau satu modul Moodle (`resource`, `quiz`, `forum`, dan lainnya). */
export interface MoodleModule {
  id: string;
  courseId: number;
  sectionPos: number;
  section: string;
  kind: string;
  name: string;
  description: string;
  /** Alamat modul di situs Moodle sendiri; kosong bila tidak ada. */
  url: string;
  files: number;
}

export interface MoodleCourseView {
  structure: MoodleModule[];
  links: MoodleLink[];
  files: MoodleFile[];
  /** Isi yang bukan berkas (halaman, kuis, tautan, dan lainnya), per jenis modul. */
  other: { kind: string; count: number }[];
  /** Berkas di server lain yang dilewati demi keamanan. */
  foreign: number;
}

export const EMPTY_STATUS: MoodleStatus = { enabled: false, connected: false, baseUrl: "", userName: "", fullName: "", siteName: "", lastSync: null, error: null, count: 0 };

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Moodle hanya tersedia di aplikasi Cognify.");
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    const err = e as { message?: string };
    throw new Error(typeof e === "string" ? e : (err?.message ?? "Terjadi kesalahan."));
  }
}

export const moodleApi = {
  status: () => (isTauri() ? call<MoodleStatus>("moodle_status") : Promise.resolve(EMPTY_STATUS)),
  setEnabled: (enabled: boolean) => call<MoodleStatus>("moodle_set_enabled", { enabled }),
  connect: (baseUrl: string, username: string, password: string) => call<MoodleStatus>("moodle_connect", { baseUrl, username, password }),
  sync: () => call<MoodleStatus>("moodle_sync"),
  disconnect: () => call<MoodleStatus>("moodle_disconnect"),
  items: () => (isTauri() ? call<MoodleItem[]>("moodle_items") : Promise.resolve([])),
  courses: () => (isTauri() ? call<MoodleCourse[]>("moodle_courses") : Promise.resolve([])),
  links: (courseId: number) => call<MoodleLink[]>("moodle_links", { courseId }),
  structure: (courseId: number) => call<MoodleModule[]>("moodle_structure", { courseId }),
  files: (courseId: number) => call<MoodleFile[]>("moodle_files", { courseId }),
  refreshCourse: (courseId: number) => call<MoodleCourseView>("moodle_refresh_course", { courseId }),
  download: (ids: string[]) => call<void>("moodle_download", { ids }),
  cancel: (ids: string[]) => call<void>("moodle_cancel", { ids }),
  deleteLocal: (ids: string[]) => call<void>("moodle_delete_local", { ids }),
  resume: () => (isTauri() ? call<void>("moodle_resume") : Promise.resolve()),
};
