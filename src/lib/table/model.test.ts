import { describe, expect, it } from "vitest";
import {
  addColumn, addOption, addRow, coerce, cycleSort, display, emptyTable, lanes, moveCard, parseTable, plainText, prTemplate, recolorOption, removeColumn, removeOption,
  removeRow, renameColumn, renameOption, scheduleTemplate, serialize, setCell, setColumnType, setGroupBy, setSort, setView, visibleRows, MAX_COLUMNS, MAX_OPTIONS, type TableData,
} from "./model";

const status = (t: TableData) => t.columns[1];
const optId = (t: TableData, label: string) => status(t).options!.find((o) => o.label === label)!.id;

function sample(): TableData {
  let t = emptyTable();
  const [title, st] = t.columns;
  t = addRow(t, { [title.id]: "Bab 1", [st.id]: optId(t, "Belum") });
  t = addRow(t, { [title.id]: "Bab 2", [st.id]: optId(t, "Selesai") });
  t = addRow(t, { [title.id]: "Bab 3" });
  return t;
}

describe("parseTable", () => {
  it("menerima data kosong, rusak, atau bukan tabel sebagai tabel baru", () => {
    for (const raw of ["", "   ", "{", "null", "[]", '{"columns":"x"}', '{"columns":[]}']) {
      const t = parseTable(raw);
      expect(t.columns.length).toBeGreaterThan(0);
      expect(t.rows).toEqual([]);
    }
  });

  it("bolak-balik serialize tidak mengubah apa pun", () => {
    const t = sample();
    expect(parseTable(serialize(t))).toEqual(t);
  });

  it("membersihkan data yang tidak sah", () => {
    const raw = JSON.stringify({
      columns: [
        { id: "a", name: "  ", type: "ngawur" },
        { id: "a", name: "Ganda", type: "number" },
        { id: "s", name: "Pilih", type: "select", options: [{ id: "o1", label: "Satu", color: 99 }, { id: "o1", label: "Dobel" }, { label: "" }, "x"] },
      ],
      rows: [{ id: "r", cells: { a: "teks", s: "tidak-ada", hilang: 1 } }, null, { id: "r", cells: {} }],
      view: "board",
      groupBy: "a",
      sort: { col: "tidak-ada", dir: "asc" },
    });
    const t = parseTable(raw);
    expect(t.columns.map((c) => c.type)).toEqual(["text", "number", "select"]);
    expect(t.columns[0].name).toBe("Kolom");
    expect(new Set(t.columns.map((c) => c.id)).size).toBe(3);
    expect(t.columns[2].options).toHaveLength(1);
    expect(t.columns[2].options![0].color).toBe(99 % 8);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].cells).toEqual({ [t.columns[0].id]: "teks" });
    expect(new Set(t.rows.map((r) => r.id)).size).toBe(2);
    expect(t.groupBy).toBe("s");
    expect(t.sort).toBeNull();
  });

  it("tampilan papan tanpa kolom pilihan jatuh ke tabel", () => {
    const t = parseTable(JSON.stringify({ view: "board", columns: [{ id: "a", name: "A", type: "text" }], rows: [] }));
    expect(t.view).toBe("table");
    expect(t.groupBy).toBeNull();
  });

  it("membatasi jumlah kolom", () => {
    const columns = Array.from({ length: MAX_COLUMNS + 10 }, (_, i) => ({ id: `c${i}`, name: `K${i}`, type: "text" }));
    expect(parseTable(JSON.stringify({ columns, rows: [] })).columns).toHaveLength(MAX_COLUMNS);
  });
});

describe("coerce", () => {
  it("mengubah nilai menurut tipe kolom", () => {
    const c = (type: any, options?: any) => ({ id: "x", name: "X", type, options });
    expect(coerce(c("number"), "3,5")).toBe(3.5);
    expect(coerce(c("number"), "abc")).toBeNull();
    expect(coerce(c("number"), Infinity)).toBeNull();
    expect(coerce(c("date"), "2026-10-22")).toBe("2026-10-22");
    expect(coerce(c("date"), "2026-13-45")).toBeNull();
    expect(coerce(c("date"), "22/10/2026")).toBeNull();
    expect(coerce(c("checkbox"), "true")).toBe(true);
    expect(coerce(c("checkbox"), null)).toBe(false);
    expect(coerce(c("select", [{ id: "o", label: "O", color: 0 }]), "o")).toBe("o");
    expect(coerce(c("select", []), "o")).toBeNull();
    expect(coerce(c("text"), "a".repeat(5000))).toHaveLength(2000);
    expect(coerce(c("text"), 5)).toBe("5");
  });
});

describe("kolom", () => {
  it("menambah, mengganti nama, dan menghapus kolom beserta isinya", () => {
    let t = sample();
    t = addColumn(t, "Catatan");
    expect(t.columns).toHaveLength(3);
    const id = t.columns[2].id;
    t = setCell(t, t.rows[0].id, id, "penting");
    t = renameColumn(t, id, "  Nota ");
    expect(t.columns[2].name).toBe("Nota");
    expect(renameColumn(t, id, "   ")).toBe(t);
    t = removeColumn(t, id);
    expect(t.columns).toHaveLength(2);
    expect(Object.keys(t.rows[0].cells)).not.toContain(id);
  });

  it("kolom terakhir tidak bisa dihapus, dan menghapus kolom pengelompokan membersihkan tampilan papan", () => {
    let t = sample();
    t = setView(t, "board");
    t = removeColumn(t, status(t).id);
    expect(t.groupBy).toBeNull();
    expect(t.view).toBe("table");
    expect(removeColumn(t, t.columns[0].id)).toBe(t);
  });

  it("mengganti tipe mengubah isi sebisanya", () => {
    let t = emptyTable();
    t = addColumn(t, "Nilai", "text");
    const id = t.columns[2].id;
    t = addRow(t, { [id]: "8,5" });
    t = addRow(t, { [id]: "halo" });
    t = setColumnType(t, id, "number");
    expect(t.rows[0].cells[id]).toBe(8.5);
    expect(t.rows[1].cells[id]).toBeUndefined();
    t = setColumnType(t, id, "text");
    expect(t.rows[0].cells[id]).toBe("8.5");
  });

  it("teks menjadi pilihan dengan satu opsi per nilai unik", () => {
    let t = emptyTable();
    t = addColumn(t, "Mapel", "text");
    const id = t.columns[2].id;
    for (const v of ["IPA", "ipa", "IPS", ""]) t = addRow(t, { [id]: v });
    t = setColumnType(t, id, "select");
    const c = t.columns[2];
    expect(c.options!.map((o) => o.label)).toEqual(["IPA", "IPS"]);
    expect(t.rows[0].cells[id]).toBe(c.options![0].id);
    expect(t.rows[1].cells[id]).toBe(c.options![0].id);
    expect(t.rows[3].cells[id]).toBeUndefined();
  });

  it("pilihan menjadi teks memakai labelnya, dan kolom pengelompokan yang bukan pilihan lagi dipindahkan", () => {
    let t = sample();
    t = setColumnType(t, status(t).id, "text");
    expect(display(t.columns[1], t.rows[0].cells[t.columns[1].id])).toBe("Belum");
    expect(t.groupBy).toBeNull();
  });
});

describe("opsi", () => {
  it("menambah tanpa duplikat, mengganti nama, warna, dan menghapus sambil mengosongkan sel", () => {
    let t = sample();
    const before = status(t).options!.length;
    t = addOption(t, status(t).id, "Ditunda");
    expect(status(t).options).toHaveLength(before + 1);
    expect(addOption(t, status(t).id, " ditunda ")).toBe(t);
    expect(addOption(t, t.columns[0].id, "x")).toBe(t);
    const id = optId(t, "Ditunda");
    t = renameOption(t, status(t).id, id, "Menunggu");
    t = recolorOption(t, status(t).id, id, -1);
    expect(status(t).options!.find((o) => o.id === id)).toMatchObject({ label: "Menunggu", color: 7 });
    t = removeOption(t, status(t).id, optId(t, "Belum"));
    expect(t.rows[0].cells[status(t).id]).toBeUndefined();
    expect(t.rows[1].cells[status(t).id]).toBe(optId(t, "Selesai"));
  });

  it("membatasi jumlah opsi", () => {
    let t = emptyTable();
    for (let i = 0; i < MAX_OPTIONS + 5; i++) t = addOption(t, status(t).id, `o${i}`);
    expect(status(t).options).toHaveLength(MAX_OPTIONS);
  });
});

describe("baris dan sel", () => {
  it("menambah, mengisi, dan menghapus", () => {
    let t = sample();
    expect(t.rows).toHaveLength(3);
    const [r] = t.rows;
    t = setCell(t, r.id, t.columns[0].id, "Diubah");
    expect(t.rows[0].cells[t.columns[0].id]).toBe("Diubah");
    t = setCell(t, r.id, t.columns[0].id, "");
    expect(t.rows[0].cells[t.columns[0].id]).toBeUndefined();
    expect(setCell(t, r.id, "tidak-ada", "x")).toBe(t);
    t = removeRow(t, r.id);
    expect(t.rows).toHaveLength(2);
  });

  it("tidak mengubah tabel asal", () => {
    const t = sample();
    const snapshot = JSON.stringify(t);
    setCell(t, t.rows[0].id, t.columns[0].id, "x");
    removeRow(t, t.rows[0].id);
    addColumn(t, "Z");
    moveCard(t, t.rows[0].id, optId(t, "Selesai"));
    expect(JSON.stringify(t)).toBe(snapshot);
  });

  it("kotak centang yang tidak dicentang tidak disimpan", () => {
    let t = addColumn(sample(), "Selesai?", "checkbox");
    const id = t.columns[2].id;
    t = setCell(t, t.rows[0].id, id, true);
    expect(t.rows[0].cells[id]).toBe(true);
    t = setCell(t, t.rows[0].id, id, false);
    expect(id in t.rows[0].cells).toBe(false);
  });
});

describe("urutan dan saringan", () => {
  it("mengurutkan teks dengan angka alami dan menaruh sel kosong di akhir", () => {
    let t = emptyTable();
    const title = t.columns[0].id;
    for (const v of ["Bab 10", "Bab 2", "", "bab 1"]) t = addRow(t, { [title]: v });
    t = setSort(t, { col: title, dir: "asc" });
    expect(visibleRows(t).map((r) => r.cells[title] ?? "")).toEqual(["bab 1", "Bab 2", "Bab 10", ""]);
    t = setSort(t, { col: title, dir: "desc" });
    expect(visibleRows(t).map((r) => r.cells[title] ?? "")).toEqual(["Bab 10", "Bab 2", "bab 1", ""]);
  });

  it("mengurutkan angka, tanggal, dan pilihan (menurut urutan opsi)", () => {
    let t = emptyTable();
    t = addColumn(t, "N", "number");
    t = addColumn(t, "D", "date");
    const [title, st, n, d] = t.columns.map((c) => c.id);
    t = addRow(t, { [title]: "a", [n]: 10, [d]: "2026-02-01", [st]: optId(t, "Selesai") });
    t = addRow(t, { [title]: "b", [n]: 9, [d]: "2026-01-15", [st]: optId(t, "Belum") });
    t = addRow(t, { [title]: "c", [n]: 100, [st]: optId(t, "Dikerjakan") });
    const order = (col: string) => visibleRows(setSort(t, { col, dir: "asc" })).map((r) => r.cells[title]);
    expect(order(n)).toEqual(["b", "a", "c"]);
    expect(order(d)).toEqual(["b", "a", "c"]);
    expect(order(st)).toEqual(["b", "c", "a"]);
  });

  it("klik judul kolom: naik, turun, lalu tanpa urutan", () => {
    let t = sample();
    const id = t.columns[0].id;
    t = cycleSort(t, id);
    expect(t.sort).toEqual({ col: id, dir: "asc" });
    t = cycleSort(t, id);
    expect(t.sort).toEqual({ col: id, dir: "desc" });
    t = cycleSort(t, id);
    expect(t.sort).toBeNull();
    expect(cycleSort(t, "x")).toBe(t);
  });

  it("menyaring menurut teks tampilan, termasuk label pilihan", () => {
    const t = sample();
    expect(visibleRows(t, "bab 2")).toHaveLength(1);
    expect(visibleRows(t, "SELESAI")).toHaveLength(1);
    expect(visibleRows(t, "  ")).toHaveLength(3);
    expect(visibleRows(t, "zzz")).toHaveLength(0);
  });
});

describe("papan (kanban)", () => {
  it("membuat lajur per pilihan dan lajur tanpa nilai hanya bila ada isinya", () => {
    const t = sample();
    const l = lanes(t);
    expect(l.map((x) => x.option?.label ?? null)).toEqual([null, "Belum", "Dikerjakan", "Selesai"]);
    expect(l.map((x) => x.rows.length)).toEqual([1, 1, 0, 1]);
    expect(lanes(removeRow(t, t.rows[2].id)).map((x) => x.option?.label)).toEqual(["Belum", "Dikerjakan", "Selesai"]);
  });

  it("memindahkan kartu ke lajur lain dan mengatur urutannya", () => {
    let t = sample();
    const [a, b, c] = t.rows.map((r) => r.id);
    const done = optId(t, "Selesai");
    t = moveCard(t, a, done, b);
    expect(t.rows.map((r) => r.id)).toEqual([a, b, c]);
    expect(t.rows[0].cells[status(t).id]).toBe(done);
    t = moveCard(t, c, done);
    expect(t.rows.map((r) => r.id)).toEqual([a, b, c]);
    expect(t.rows[2].cells[status(t).id]).toBe(done);
    t = moveCard(t, a, done, c);
    expect(t.rows.map((r) => r.id)).toEqual([b, a, c]);
    t = moveCard(t, b, null);
    expect(t.rows.find((r) => r.id === b)!.cells[status(t).id]).toBeUndefined();
  });

  it("memindahkan ke lajur kosong menaruh kartu di akhir dan tidak melakukan apa pun tanpa pengelompokan", () => {
    let t = sample();
    const [a] = t.rows.map((r) => r.id);
    t = moveCard(t, a, optId(t, "Dikerjakan"));
    expect(t.rows[t.rows.length - 1].id).toBe(a);
    expect(moveCard(t, "tidak-ada", null)).toBe(t);
    expect(moveCard(t, a, null, a)).toBe(t);
    const plain = { ...t, groupBy: null };
    expect(moveCard(plain, a, null)).toBe(plain);
  });

  it("pengaturan tampilan dan pengelompokan divalidasi", () => {
    let t = sample();
    expect(setGroupBy(t, t.columns[0].id)).toBe(t);
    t = addColumn(t, "Tingkat", "select");
    expect(setGroupBy(t, t.columns[2].id).groupBy).toBe(t.columns[2].id);
    expect(setView({ ...t, groupBy: null }, "board").view).toBe("table");
  });
});

describe("teks polos dan templat", () => {
  it("mencakup nama kolom dan isi sel yang tampak", () => {
    const text = plainText(sample());
    expect(text).toContain("Judul Status");
    expect(text).toContain("Bab 1 Belum");
    expect(text).toContain("Bab 3");
  });

  it("templat sah dan lolos penguraian tanpa perubahan", () => {
    for (const make of [prTemplate, scheduleTemplate]) {
      const t = make();
      expect(parseTable(serialize(t))).toEqual(t);
      expect(t.groupBy).not.toBeNull();
    }
    expect(prTemplate().view).toBe("board");
  });
});
