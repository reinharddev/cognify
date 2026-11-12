import { describe, expect, it } from "vitest";
import { CIS, isCis, runCis, runSdc } from "../../../extension/cognify.js";

// Tiruan halaman portal: exec menjalankan fungsi pembaca dengan hasil yang sudah ditentukan, nav mencatat urutan perpindahan.
const PROGRESS_URL = `${CIS.origin}/index.php/school_self_development/my_commitment/view_progress/abc/def/1/xyz/1/uvw/1/S/`;
const LIST = {
  period: "12.2 / First / 2026-2027",
  rows: [
    { name: "Self Development Challenge", view: `${CIS.origin}/v1`, progress: PROGRESS_URL },
    { name: "Self Development Challenge - Revision", view: `${CIS.origin}/v2`, progress: "" },
  ],
};
const PROGRESS = {
  headers: ["Challenge", "Week - 1 ( in minutes )"],
  rows: [["PoCC Informatika (3 jam 30 menit per minggu)", "membuat website", "225"]],
};

function harness(opts: { list?: typeof LIST; progress?: typeof PROGRESS } = {}) {
  const log: string[] = [];
  const posts: { kind: string; period: string; tables: unknown }[] = [];
  const exec = async (func: { name: string }) => {
    if (func.name === "readSdcList") return opts.list ?? LIST;
    if (func.name === "readSdcProgress") return opts.progress ?? PROGRESS;
    if (func.name === "activeTab") return "";
    if (func.name === "pageInfo") return { hasSelect: false, options: [], current: "", shown: "" }; // tab nilai tidak ada di tiruan ini
    return { error: "no_reg" }; // kehadiran
  };
  const nav = async (url: string) => void log.push(url);
  const post = async (kind: string, period: string, tables: unknown) => void posts.push({ kind, period, tables });
  return { log, posts, exec, nav, post, sleep: async () => {} };
}

describe("alur ekstensi di portal CIS", () => {
  it("mengenali alamat portal saja", () => {
    expect(isCis(`${CIS.origin}/home/school_dashboard`)).toBe(true);
    expect(isCis("https://student.citrakasih.sch.id.evil.test/x")).toBe(false);
    expect(isCis("http://student.citrakasih.sch.id/x")).toBe(false);
    expect(isCis("bukan url")).toBe(false);
  });

  it("SDC: daftar, lalu Progress tantangan yang bukan Revision, kirim, dan berakhir di halaman awal SDC", async () => {
    const h = harness();
    const out = await runSdc(h);
    const sdcUrl = CIS.origin + CIS.sdc;
    expect(h.log).toEqual([sdcUrl, PROGRESS_URL, sdcUrl]);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({ kind: "sdc", period: "12.2 / First / 2026-2027" });
    expect(h.posts[0].tables).toEqual([{ headers: PROGRESS.headers, rows: PROGRESS.rows }]);
    expect(out).toEqual({ period: "12.2 / First / 2026-2027", challenges: 1 });
  });

  it("SDC: tanpa tautan Progress atau tabel kosong, galatnya jelas dan tidak ada yang terkirim", async () => {
    const none = harness({ list: { period: "", rows: [{ name: "X - Revision", view: "v", progress: "" }] } });
    await expect(runSdc(none)).rejects.toThrow(/tidak ada tantangan/i);
    expect(none.posts).toHaveLength(0);
    const empty = harness({ progress: { headers: [], rows: [] } });
    await expect(runSdc(empty)).rejects.toThrow(/tidak terbaca/i);
    expect(empty.posts).toHaveLength(0);
  });

  it("dari halaman mana pun: pindah ke Academic dulu, lalu SDC", async () => {
    const h = harness();
    const report: Record<string, any> = await runCis({ ...h, tabUrl: `${CIS.origin}/home/school_dashboard` });
    expect(h.log[0]).toBe(CIS.origin + CIS.academic);
    expect(h.log.at(-1)).toBe(CIS.origin + CIS.sdc); // berakhir di halaman awal SDC
    expect(h.posts.some((p) => p.kind === "sdc")).toBe(true);
    expect(report.sdc).toMatchObject({ challenges: 1 });
    expect(report.summary).toContain("SDC 1 tantangan");
  });

  it("sudah di halaman Academic: tidak pindah dua kali", async () => {
    const h = harness();
    await runCis({ ...h, tabUrl: `${CIS.origin}${CIS.academic}` });
    expect(h.log[0]).toBe(CIS.origin + CIS.sdc);
  });

  it("SDC gagal tidak menghapus hasil bagian lain, dan dilaporkan", async () => {
    const h = harness({ list: { period: "", rows: [] } });
    const report: Record<string, any> = await runCis({ ...h, tabUrl: `${CIS.origin}${CIS.academic}` });
    expect(report.failed.some((f: string) => f.startsWith("SDC:"))).toBe(true);
    expect(report.sdc).toBeUndefined();
  });
});
