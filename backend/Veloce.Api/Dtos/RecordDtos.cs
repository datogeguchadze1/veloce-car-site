namespace Veloce.Api.Dtos;

// Sent by the test drive after a lap or a drift. Either value may be missing.
public record SubmitRecordRequest(string CarId, string Track, int? LapMs, int? Drift);
// improved: the result beat the player's own best; rank: the player's place after the update.
public record SubmitRecordResponse(bool LapImproved, int? LapRank, bool DriftImproved, int? DriftRank);
public record MyRecordDto(string CarId, string Track, int? LapMs, int? Drift);
public record LeaderboardRow(int Rank, int UserId, string Name, int Value, DateTime? At, bool Me);
public record TopResult(string Name, int Value);
public record TrackBest(TopResult? Lap, TopResult? Drift);
public record AdminRecordDto(int UserId, string Name, string CarId, string Track, int? LapMs, int? Drift, DateTime? LapAt, DateTime? DriftAt);
