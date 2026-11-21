using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Veloce.Api.Models;

namespace Veloce.Api.Data;

public class VeloceDbContext(DbContextOptions<VeloceDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<LapRecord> Records => Set<LapRecord>();
    public DbSet<Favorite> Favorites => Set<Favorite>();
    public DbSet<Tuning> Tunings => Set<Tuning>();
    public DbSet<Car> Cars => Set<Car>();

    // every time is stored in UTC; mark it as UTC when read back so JSON gets a trailing "Z"
    protected override void ConfigureConventions(ModelConfigurationBuilder c)
    {
        c.Properties<DateTime>().HaveConversion<UtcConverter>();
        c.Properties<DateTime?>().HaveConversion<UtcConverter>();
    }
    private class UtcConverter() : ValueConverter<DateTime, DateTime>(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.Property(u => u.Email).HasMaxLength(254);
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.DisplayName).HasMaxLength(40);
            e.Property(u => u.PasswordHash).HasMaxLength(200);
            e.Property(u => u.CreatedAt).HasDefaultValueSql("SYSUTCDATETIME()");
        });

        b.Entity<LapRecord>(e =>
        {
            e.ToTable("Records");
            e.HasKey(r => new { r.UserId, r.CarId, r.Track });
            e.Property(r => r.CarId).HasMaxLength(40);
            e.Property(r => r.Track).HasMaxLength(20);
            e.HasOne(r => r.User).WithMany(u => u.Records).HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
            // leaderboards read "best laps / best drifts for a car on a track"
            e.HasIndex(r => new { r.CarId, r.Track, r.LapMs });
            e.HasIndex(r => new { r.CarId, r.Track, r.Drift });
        });

        b.Entity<Favorite>(e =>
        {
            e.HasKey(f => new { f.UserId, f.CarId });
            e.Property(f => f.CarId).HasMaxLength(40);
            e.HasOne(f => f.User).WithMany(u => u.Favorites).HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Tuning>(e =>
        {
            e.Property(t => t.CarId).HasMaxLength(40);
            e.Property(t => t.Name).HasMaxLength(40);
            e.Property(t => t.Json).HasMaxLength(4000);
            e.HasOne(t => t.User).WithMany(u => u.Tunings).HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(t => new { t.UserId, t.CarId });
        });

        b.Entity<Car>(e =>
        {
            e.Property(c => c.Id).HasMaxLength(40);
            e.Property(c => c.Brand).HasMaxLength(60);
            e.Property(c => c.Name).HasMaxLength(80);
            e.Property(c => c.Chassis).HasMaxLength(40);
            e.Property(c => c.Years).HasMaxLength(40);
            e.Property(c => c.Body).HasMaxLength(40);
            e.Property(c => c.Era).HasMaxLength(20);
            e.Property(c => c.Description).HasMaxLength(2000);
            e.Property(c => c.SpecsJson).HasMaxLength(2000);
        });
    }
}
