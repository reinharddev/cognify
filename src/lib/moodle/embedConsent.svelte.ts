// Izin memuat embed dari canva.com di dalam Cognify. Bawaannya belum diizinkan: memuat embed berarti app
// menghubungi server Canva (di luar Moodle), jadi pengguna harus menyetujuinya dulu. Izin bisa dicabut di Pengaturan.

const KEY = "cognify.embed.canva";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

class EmbedConsent {
  canva = $state(read());

  grant() {
    this.canva = true;
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* izin hanya berlaku sampai app ditutup */
    }
  }

  revoke() {
    this.canva = false;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* tidak ada yang perlu dilakukan */
    }
  }
}

export const embedConsent = new EmbedConsent();
