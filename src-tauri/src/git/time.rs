//! Local timestamps for conflict copy names without a date-time crate.
//!
//! libgit2 already knows the local UTC offset (it needs it for commit signatures), so we reuse
//! that and do the civil-date arithmetic ourselves.

use std::time::{SystemTime, UNIX_EPOCH};

/// A point in time plus the local UTC offset libgit2 reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalTime {
    pub unix_secs: i64,
    pub offset_minutes: i32,
}

impl LocalTime {
    pub fn now() -> Self {
        let unix_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
            .unwrap_or(0);
        let offset_minutes = git2::Signature::now("git-notes", "git-notes@localhost")
            .map(|s| s.when().offset_minutes())
            .unwrap_or(0);
        Self {
            unix_secs,
            offset_minutes,
        }
    }

    pub fn unix_ms(&self) -> i64 {
        self.unix_secs.saturating_mul(1000)
    }

    /// `YYYY-MM-DD HHmm` in local time, as used in conflict copy names.
    pub fn stamp(&self) -> String {
        let local = self.unix_secs + i64::from(self.offset_minutes) * 60;
        let days = local.div_euclid(86_400);
        let secs = local.rem_euclid(86_400);
        let (year, month, day) = civil_from_days(days);
        format!(
            "{year:04}-{month:02}-{day:02} {:02}{:02}",
            secs / 3600,
            (secs % 3600) / 60
        )
    }
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (
        year,
        u32::try_from(month).unwrap_or(1),
        u32::try_from(day).unwrap_or(1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_is_1970() {
        let t = LocalTime {
            unix_secs: 0,
            offset_minutes: 0,
        };
        assert_eq!(t.stamp(), "1970-01-01 0000");
    }

    #[test]
    fn formats_utc_and_offset() {
        // 2023-11-14T22:13:20Z
        let utc = LocalTime {
            unix_secs: 1_700_000_000,
            offset_minutes: 0,
        };
        assert_eq!(utc.stamp(), "2023-11-14 2213");
        let plus5 = LocalTime {
            unix_secs: 1_700_000_000,
            offset_minutes: 300,
        };
        assert_eq!(plus5.stamp(), "2023-11-15 0313");
        let minus8 = LocalTime {
            unix_secs: 1_700_000_000,
            offset_minutes: -480,
        };
        assert_eq!(minus8.stamp(), "2023-11-14 1413");
    }

    #[test]
    fn leap_day() {
        // 2024-02-29T12:00:00Z
        let t = LocalTime {
            unix_secs: 1_709_208_000,
            offset_minutes: 0,
        };
        assert_eq!(t.stamp(), "2024-02-29 1200");
    }

    #[test]
    fn now_is_recent() {
        assert!(LocalTime::now().unix_secs > 1_700_000_000);
    }
}
