# VELOCE Garage API (C#, ASP.NET Core + SQL Server)

საიტის ბექენდი: ანგარიშები, საერთო ლიდერბორდი, „ჩემი გარაჟი“ (რჩეული მანქანები და ტუნინგები) და ადმინ-პანელი. მონაცემები ინახება **Microsoft SQL Server**-ში, **Entity Framework Core**-ის საშუალებით.

- .NET 10 (LTS), ASP.NET Core Web API, კონტროლერები
- EF Core 10 + SQL Server, მიგრაციები (`Migrations/`)
- JWT ავტორიზაცია, პაროლების ჰეში (`PasswordHasher`), შესვლის მცდელობების ლიმიტი
- Swagger (ტესტირებისთვის ბრაუზერში), `Veloce.Api.http` (მოთხოვნები Visual Studio-დან)

## Visual Studio-ში გახსნა

1. საჭიროა **Visual Studio 2026** (ან 2022 17.14+) და კომპონენტი **ASP.NET and web development**.
2. **File → Open → Project/Solution** → `backend/Veloce.sln`.
3. დააყენე connection string (ქვემოთ, „საიდუმლოები“).
4. **F5**: გაიხსნება ბრაუზერი `http://localhost:5080`-ზე. ერთი და იგივე მისამართი ემსახურება 3D საიტსაც და API-საც (`/api/...`), ამიტომ შესვლა, გარაჟი და ლიდერბორდი მაშინვე მუშაობს.
   - გაშვების პროფილი **Swagger** (F5-ის გვერდით ისარი): API-ს სატესტო გვერდი, `/swagger`.
   - პირველი გაშვებისას ბაზაში ცხრილები თავისით იქმნება (`Database.Migrate()`).

### საიდუმლოები (connection string)
რეპოზიტორია საჯაროა, ამიტომ პაროლები `appsettings.json`-ში **არ** იწერება. Visual Studio-ში:
**Solution Explorer → `Veloce.Api`-ზე მარჯვენა ღილაკი → Manage User Secrets**, და ჩაწერე:

```json
{
  "ConnectionStrings": {
    "Veloce": "Server=SERVER;Database=DATABASE;User Id=USER;Password=PASSWORD;TrustServerCertificate=True;"
  },
  "Jwt": {
    "Key": "აქ ჩაწერე შემთხვევითი გრძელი სტრიქონი, მინიმუმ 32 სიმბოლო"
  },
  "Admin": {
    "Emails": [ "შენი@ელფოსტა.ge" ]
  }
}
```

ეს ფაილი ინახება შენს კომპიუტერზე, პროექტის გარეთ, და GitHub-ზე არასდროს ხვდება. შეცვლის შემდეგ პროექტი თავიდან გაუშვი (Shift+F5, F5).

connection string-ის მაგალითები:

| სად არის ბაზა | connection string (User Secrets-ის JSON-ში ჩასაწერად) |
|---|---|
| კომპიუტერზე დაყენებული SQL Server, Windows-ის ანგარიშით | `Server=localhost;Database=Veloce;Trusted_Connection=True;TrustServerCertificate=True;` |
| SQL Server Express | `Server=.\\SQLEXPRESS;Database=Veloce;Trusted_Connection=True;TrustServerCertificate=True;` |
| LocalDB (Visual Studio-სთან ერთად დგება) | `Server=(localdb)\\MSSQLLocalDB;Database=Veloce;Trusted_Connection=True;` |
| ჰოსტინგი / SQL login | `Server=HOST,1433;Database=DB;User Id=USER;Password=PASS;TrustServerCertificate=True;` |

JSON-ში `\` ორმაგად იწერება (`.\\SQLEXPRESS`). ბაზა თუ ჯერ არ არსებობს, პირველ გაშვებაზე თავისით შეიქმნება.

**შესვლის ღილაკის ნაცვლად თუ „⚠ ბაზა არ არის დაკავშირებული“ ჩანს**, დააჭირე მას: ფანჯარა აჩვენებს SQL Server-ის შეცდომას და რჩევას (მაგ. „დაამატე TrustServerCertificate=True“). იგივე ჩანს `http://localhost:5080/api/health`-ზე და Visual Studio-ს Output ფანჯარაში.
- `Admin:Emails`: ამ ელ-ფოსტით რეგისტრაცია ან შესვლა ავტომატურად ადმინად გხდის. სია თუ ცარიელია, ადმინი ხდება პირველი დარეგისტრირებული ანგარიში.
- `Jwt:Key`: Development-ში თუ არ დააყენე, დროებითი გასაღები შეიქმნება (გადატვირთვისას შესვლა გაუქმდება). სერვერზე სავალდებულოა.

## სტრუქტურა

| ფაილი | რა არის შიგნით |
|---|---|
| `Program.cs` | სერვისების რეგისტრაცია: ბაზა, JWT, ლიმიტი, CORS, Swagger, საიტის ფაილები, მიგრაცია გაშვებისას |
| `Data/VeloceDbContext.cs` | EF Core კონტექსტი: ცხრილები, გასაღებები, ინდექსები |
| `Models/` | ცხრილები: `User`, `LapRecord` (`Records`), `Favorite`, `Tuning`, `Car` |
| `Dtos/` | API-ს მოთხოვნები და პასუხები |
| `Controllers/AuthController.cs` | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| `Controllers/RecordsController.cs` | `POST /api/records`, `GET /api/records/mine`, `GET /api/leaderboard`, `GET /api/leaderboard/best` |
| `Controllers/GarageController.cs` | `GET /api/garage`, რჩეულები (`PUT`/`DELETE /api/garage/favorites/{car}`), ტუნინგები (`/api/garage/tunings`) |
| `Controllers/CarsController.cs` | `GET /api/cars`, `GET /api/cars/hidden`: ადმინის მიერ შეცვლილი კატალოგი |
| `Controllers/AdminController.cs` | `/api/admin/...`: სტატისტიკა, მანქანები, მომხმარებლები, რეკორდები (მხოლოდ ადმინს) |
| `Controllers/HealthController.cs` | `GET /api/health`: მუშაობს თუ არა API და ბაზა |
| `Services/` | JWT ტოკენი, თამაშის წესები (ტრასები, დროის ზღვრები), ადმინის შემოწმება |
| `Migrations/` | ბაზის სქემა (EF Core მიგრაცია) |
| `Veloce.Api.http` | მზა მოთხოვნები Visual Studio-დან გასაგზავნად |
| `../tests/api-smoke.mjs` | ავტომატური შემოწმება გაშვებულ API-ზე: `node backend/tests/api-smoke.mjs` |

### ცხრილები
- **Users**: ელ-ფოსტა (უნიკალური), სახელი, პაროლის ჰეში, ადმინია თუ არა.
- **Records**: თითო მომხმარებელს, მანქანას და ტრასას ერთი ჩანაწერი აქვს: საუკეთესო წრე (მილიწამი) და საუკეთესო დრიფტი.
- **Favorites**: რჩეული მანქანები.
- **Tunings**: შენახული ტუნინგი (JSON: ფერი, საფარი, დისკები, სიმაღლე, ტონირება, ფარები, სალონი).
- **Cars**: კატალოგის ტექსტები, რომლებსაც ადმინი ცვლის. 3D მოდელების პარამეტრები `js/models.js`-ში რჩება.

### ბაზის შეცვლა
მოდელში ველის დამატების შემდეგ: **Tools → NuGet Package Manager → Package Manager Console**:
```
Add-Migration ველის_სახელი
Update-Database
```
(ტერმინალში: `dotnet ef migrations add ველის_სახელი`, `dotnet ef database update`.)

## როგორ მუშაობს საიტთან ერთად
- საიტი (`js/api.js`) ჯერ ამოწმებს `GET /api/health`-ს. თუ პასუხი არ მოვიდა (მაგ. GitHub Pages), ანგარიშის ღილაკები იმალება და საიტი მუშაობს როგორც ადრე: რეკორდები და ტუნინგი ბრაუზერში ინახება.
- შესვლის შემდეგ ტოკენი ინახება ბრაუზერში და იგზავნება `Authorization: Bearer ...` სათაურით.
- ტესტ-დრაივზე დასრულებული წრე და დრიფტი სერვერზე იგზავნება მხოლოდ მაშინ, როცა შენს საუკეთესო შედეგს აუმჯობესებს. HUD-ზე ჩანს ადგილი („🏆 ადგილი #3“).
- ადმინ-პანელი: `admin.html` (მენიუში „⚙ ადმინ-პანელი“). პირველად დააჭირე „🌱 შევსება models.js-იდან“: კატალოგის ტექსტები ბაზაში გადავა და იქიდან შეიცვლება.

## ატვირთვა ინტერნეტში: Vercel
Vercel-ს C#-ის საკუთარი runtime არ აქვს, მაგრამ უშვებს Docker კონტეინერს (Container runtime). `backend/Dockerfile` მზადაა. 3D მოდელები დიდია (ფუნქციის პასუხი ≤ 4.5 MB), ამიტომ საიტი და API **ორ Vercel პროექტად** იტვირთება ერთი რეპოდან:

**1. API**
1. vercel.com → **Add New → Project** → აირჩიე `veloce-car-site` რეპო.
2. **Root Directory**: `backend` (Vercel თვითონ იპოვის `Dockerfile`-ს, Framework: Container).
3. **Environment Variables**:
   - `ConnectionStrings__Veloce`: connection string (`TrustServerCertificate=True`-ით);
   - `Jwt__Key`: შემთხვევითი ტექსტი, 32+ სიმბოლო;
   - `Admin__Emails__0`: შენი ელ-ფოსტა.
4. **Deploy**. შემოწმება: `https://<api-პროექტი>.vercel.app/api/health` → `{"ok":true,"db":true}`.

**2. საიტი**
1. რეპოში `vercel.json`-ში `SET-YOUR-API-ADDRESS.invalid` შეცვალე API-ს მისამართით (მაგ. `veloce-api-xxxx.vercel.app`) და დააკომიტე.
2. vercel.com → **Add New → Project** → იგივე რეპო, **Root Directory** ცარიელი (რეპოს ძირი), Framework: Other. build არ სჭირდება.
3. **Deploy**. საიტი `/api`-ს API პროექტზე გადაამისამართებს, ასე რომ ორივე ერთ მისამართზე მუშაობს.

**მნიშვნელოვანი:** Vercel ინტერნეტშია, ამიტომ **SQL Server-იც ინტერნეტიდან ხელმისაწვდომი უნდა იყოს**. კომპიუტერზე დაყენებულ ლოკალურ სერვერს (`localhost`, `.\SQLEXPRESS`, LocalDB) Vercel ვერ მიწვდება.
- გამოდგება ონლაინ MSSQL ბაზა, რომელიც გარე კავშირს უშვებს (მაგ. MonsterASP.NET-ის ან somee.com-ის უფასო MSSQL);
- Vercel-ის IP მისამართები ცვალებადია, ამიტომ firewall-მა ყველა IP უნდა დაუშვას.

ლოკალური შემოწმება Docker-ით: `docker build -t veloce-api backend` → `docker run -p 8099:80 -e ConnectionStrings__Veloce=... -e Jwt__Key=... veloce-api` → `node backend/tests/api-smoke.mjs http://localhost:8099`.
