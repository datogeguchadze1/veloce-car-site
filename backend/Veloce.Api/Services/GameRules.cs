using System.Text.RegularExpressions;

namespace Veloce.Api.Services;

// What the server accepts from the game: known tracks, sane lap times and drift scores.
public static partial class GameRules
{
    // the test-drive tracks in js/drive.js (TRACKS)
    public static readonly HashSet<string> Tracks = ["circuit", "city", "mountain"];

    public const int MinLapMs = 15_000;          // no track can be lapped faster
    public const int MaxLapMs = 15 * 60_000;
    public const int MaxDrift = 1_000_000;
    public const int MaxTuningJson = 4000;

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{0,39}$")]
    public static partial Regex CarIdRegex();

    [GeneratedRegex(@"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")]
    public static partial Regex EmailRegex();

    public static bool IsCarId(string? id) => id is not null && CarIdRegex().IsMatch(id);
}
