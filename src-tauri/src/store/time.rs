//! Waktu UTC dalam format ISO-8601 (`2026-10-22T08:33:12.345Z`), tanpa dependensi tambahan.

use std::time::{SystemTime, UNIX_EPOCH};

/// Hari sejak 1970-01-01 menjadi (tahun, bulan, tanggal) kalender Gregorian.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

pub fn format_millis(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let (y, mo, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!("{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

pub fn utc_now() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    format_millis(ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_instants_format_correctly() {
        assert_eq!(format_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_millis(951_782_400_000), "2000-02-29T00:00:00.000Z"); // tahun kabisat
        assert_eq!(format_millis(1_792_633_992_345), "2026-10-22T01:53:12.345Z");
        assert_eq!(format_millis(-1), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn now_has_the_expected_shape_and_sorts_as_text() {
        let a = utc_now();
        assert_eq!(a.len(), 24);
        assert!(a.ends_with('Z'));
        assert!(utc_now() >= a);
    }
}
