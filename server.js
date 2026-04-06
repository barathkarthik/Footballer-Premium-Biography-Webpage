const express = require('express');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const app = express();
const PORT = 3000;

// --- Database setup ---
const db = new Database(path.join(__dirname, 'football.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Drop all old tables and recreate fresh
const hasPlayersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='players'").get();
if (!hasPlayersTable) {
  db.exec(`
    DROP TABLE IF EXISTS quiz_scores;
    DROP TABLE IF EXISTS quiz_questions;
    DROP TABLE IF EXISTS comments;
    DROP TABLE IF EXISTS duo_votes;
    DROP TABLE IF EXISTS duos;
    DROP TABLE IF EXISTS players;
    DROP TABLE IF EXISTS votes;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dob TEXT,
    gender TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    position TEXT NOT NULL,
    nationality TEXT,
    image TEXT,
    stats_image TEXT,
    vote_image TEXT,
    stats_json TEXT NOT NULL,
    bio_json TEXT NOT NULL,
    donut_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS duos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    player1_id INTEGER NOT NULL REFERENCES players(id),
    player2_id INTEGER NOT NULL REFERENCES players(id),
    comparison_json TEXT NOT NULL,
    has_timeline INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS duo_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    duo_id INTEGER NOT NULL REFERENCES duos(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, duo_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    duo_id INTEGER NOT NULL REFERENCES duos(id),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS votes (
    user_id INTEGER PRIMARY KEY,
    player TEXT NOT NULL CHECK(player IN ('messi', 'ronaldo')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// --- Seed data ---
function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) as c FROM players').get().c;
  if (count > 0) return;

  const insertPlayer = db.prepare(`
    INSERT INTO players (name, full_name, position, nationality, image, stats_image, vote_image, stats_json, bio_json, donut_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDuo = db.prepare(`
    INSERT INTO duos (slug, title, player1_id, player2_id, comparison_json, has_timeline)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const players = [
    {
      name: 'messi', full_name: 'Lionel Messi', position: 'forward', nationality: 'Argentina',
      image: 'Messi.png', stats_image: 'Messi stats png.PNG', vote_image: 'Messi kicking.png',
      stats: [
        { label: 'GOALS', left: 805 },
        { label: 'ASSISTS', left: 357 },
        { label: 'TOTAL TROPHIES', left: 44 },
        { label: "BALLON D'OR", left: 8 },
        { label: 'EUROPEAN GOLDEN BOOTS', left: 6 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 4 },
        { label: 'INTERNATIONAL GOALS', left: 129 },
        { label: 'WORLD CUPS', left: 1 }
      ],
      bio: [
        {
          title: 'Early Life — Lionel Messi',
          text: 'Born on June 24, 1987, in Rosario, Argentina, Lionel Andrés Messi grew up in a tight-knit family with a deep passion for football. He joined the local club Newell\'s Old Boys at age six, quickly becoming the standout of his youth team, known as "The Machine of \'87." At age 11, Messi was diagnosed with a growth hormone deficiency — a condition that threatened to end his career before it began. When Argentine clubs couldn\'t afford his treatment, FC Barcelona offered to cover the costs, and at just 13, Messi moved to Spain to join La Masia, Barcelona\'s legendary youth academy.',
          image: 'assets/messi-young.png'
        },
        {
          title: 'The Barcelona Era',
          text: 'Messi\'s peak at Barcelona came between 2009 and 2012 under Pep Guardiola. During this era, he won four consecutive Ballon d\'Or awards and scored 91 goals in the 2012 calendar year — a record that still stands. His playing style combined close dribbling, spatial awareness, and elite finishing, making him virtually unplayable. He left Barcelona in 2021 as the club\'s all-time top scorer with 672 goals.',
          image: 'assets/messi-barcelona-era.png'
        },
        {
          title: 'Legacy and World Cup Triumph',
          text: 'After years of heartbreak with Argentina, Messi finally lifted the Copa América in 2021, defeating Brazil in the final. Then came the ultimate triumph: the 2022 FIFA World Cup in Qatar, where Messi delivered one of the greatest tournament performances in history, scoring seven goals including a brace in the final against France. At 35, he completed football\'s greatest individual journey.',
          image: 'assets/messi-worldcup.png'
        }
      ],
      donuts: [{ label: 'Goals', percent: 92 }, { label: 'Assists', percent: 95 }, { label: 'Trophies', percent: 90 }]
    },
    {
      name: 'ronaldo', full_name: 'Cristiano Ronaldo', position: 'forward', nationality: 'Portugal',
      image: 'Cristiano.png', stats_image: 'Ronaldo stats png.PNG', vote_image: 'Cristiano_vote.png',
      stats: [
        { label: 'GOALS', left: 873 },
        { label: 'ASSISTS', left: 248 },
        { label: 'TOTAL TROPHIES', left: 35 },
        { label: "BALLON D'OR", left: 5 },
        { label: 'EUROPEAN GOLDEN BOOTS', left: 4 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 5 },
        { label: 'INTERNATIONAL GOALS', left: 136 },
        { label: 'WORLD CUPS', left: 0 }
      ],
      bio: [
        {
          title: 'Early Life — Cristiano Ronaldo',
          text: 'Born on February 5, 1985, in Funchal, Madeira, Portugal, Cristiano Ronaldo dos Santos Aveiro grew up in a humble household. At age eight, he joined Andorinha, a local youth club where his father worked as kit manager. By twelve, he had moved to mainland Portugal to join Sporting CP\'s academy in Lisbon — a decision that meant leaving his family behind. At just 18, after a stunning pre-season performance against Manchester United, Sir Alex Ferguson signed him, and Ronaldo\'s legend began.',
          image: 'assets/ronaldo-young.png'
        },
        {
          title: 'Rise of a Superstar',
          text: 'At Manchester United, Ronaldo evolved from a flashy winger into one of the most complete players in history under Sir Alex Ferguson. His 2007-2008 season — 42 goals, a Premier League title, and a Champions League trophy — earned him his first Ballon d\'Or. In 2009, Real Madrid paid a then-world record fee of £80 million. At the Bernabéu, he became the greatest scorer in the club\'s history with 450 goals in 438 games, winning four Champions League titles.',
          image: 'assets/ronaldo-real-madrid.png'
        },
        {
          title: 'Legacy of a Champion',
          text: 'Ronaldo\'s legacy extends across four leagues and two decades. At Real Madrid, he won four UEFA Champions League titles between 2014 and 2018, becoming the competition\'s all-time leading scorer. In 2016, he captained Portugal to their first-ever European Championship, a defining moment in his international career. His relentless goal-scoring across England, Spain, Italy, and Saudi Arabia cemented him as one of football\'s most decorated and driven athletes.',
          image: 'assets/ronaldo-portugal-trophy.png'
        }
      ],
      donuts: [{ label: 'Goals', percent: 96 }, { label: 'Assists', percent: 88 }, { label: 'Trophies', percent: 85 }]
    },
    {
      name: 'courtois', full_name: 'Thibaut Courtois', position: 'goalkeeper', nationality: 'Belgium',
      image: 'Courtois.jpg', stats_image: 'Courtois.jpg', vote_image: 'Courtois.jpg',
      stats: [
        { label: 'APPEARANCES', left: 650 },
        { label: 'CLEAN SHEETS', left: 250 },
        { label: 'SAVES', left: 2100 },
        { label: 'TROPHIES', left: 14 },
        { label: 'PENALTIES SAVED', left: 18 },
        { label: 'GOLDEN GLOVE AWARDS', left: 2 },
        { label: 'INTERNATIONAL CAPS', left: 102 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 1 }
      ],
      bio: [
        {
          title: 'Early Life — Thibaut Courtois',
          text: 'Born on May 11, 1992, in Bree, Belgium, Thibaut Courtois showed exceptional talent between the posts from an early age. He joined the youth academy of Racing Genk at age seven, progressing rapidly through their ranks. His towering 6\'6" frame combined with cat-like reflexes made him stand out. At just 18, he was signed by Chelsea, though he was immediately loaned to Atlético Madrid — a move that would shape him into one of the world\'s elite goalkeepers.',
          image: 'Courtois.jpg'
        },
        {
          title: 'The Rise to World Class',
          text: 'At Atlético Madrid, Courtois became a wall. He helped Diego Simeone\'s side win La Liga in 2014 and reach the Champions League final. Returning to Chelsea, he won two Premier League titles before securing his dream move to Real Madrid in 2018. At the Bernabéu, he reached another level entirely — his masterclass in the 2022 Champions League final against Liverpool, making nine saves, is considered one of the greatest goalkeeping performances in a final.',
          image: 'Courtois.jpg'
        },
        {
          title: 'Legacy — The Modern Wall',
          text: 'Courtois has established himself as one of the defining goalkeepers of his generation. His Champions League final performance in 2022, where he was named Man of the Match after denying Liverpool repeatedly, cemented his status. For Belgium, he has been the undisputed number one for over a decade, featuring in two World Cups. A devastating knee injury in 2023 tested his resolve, but his determination to return underlined his champion\'s mentality.',
          image: 'Courtois.jpg'
        }
      ],
      donuts: [{ label: 'Saves', percent: 88 }, { label: 'Clean Sheets', percent: 91 }, { label: 'Reflexes', percent: 94 }]
    },
    {
      name: 'neuer', full_name: 'Manuel Neuer', position: 'goalkeeper', nationality: 'Germany',
      image: 'Neuer.jpg', stats_image: 'Neuer.jpg', vote_image: 'Neuer.jpg',
      stats: [
        { label: 'APPEARANCES', left: 820 },
        { label: 'CLEAN SHEETS', left: 340 },
        { label: 'SAVES', left: 2800 },
        { label: 'TROPHIES', left: 28 },
        { label: 'PENALTIES SAVED', left: 22 },
        { label: 'GOLDEN GLOVE AWARDS', left: 4 },
        { label: 'INTERNATIONAL CAPS', left: 118 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 2 }
      ],
      bio: [
        {
          title: 'Early Life — Manuel Neuer',
          text: 'Born on March 27, 1986, in Gelsenkirchen, Germany, Manuel Peter Neuer joined Schalke 04\'s youth academy at the age of five. Growing up in a working-class city shaped his tough, competitive mentality. He rose through the ranks to become Schalke\'s first-choice goalkeeper by age 21, quickly earning a reputation for his revolutionary "sweeper-keeper" style — rushing off his line to intercept through balls and acting as an extra outfield player.',
          image: 'Neuer.jpg'
        },
        {
          title: 'The Bayern Munich Era',
          text: 'Neuer\'s 2011 move to Bayern Munich transformed both the club and the position. Under Pep Guardiola, his sweeper-keeper role was perfected — he became football\'s first truly modern goalkeeper, equally comfortable with the ball at his feet as with his hands. The 2012-13 treble was his crowning achievement, but it was the 2014 World Cup in Brazil where he redefined goalkeeping forever, winning the Golden Glove as Germany lifted the trophy.',
          image: 'Neuer.jpg'
        },
        {
          title: 'Legacy — The Sweeper-Keeper Revolution',
          text: 'Manuel Neuer didn\'t just play the goalkeeper position — he reinvented it. His ability to read the game, sweep behind the defensive line, and distribute like a midfielder changed how coaches worldwide think about the position. With 28 major trophies, a World Cup, and two Champions League titles, he is widely regarded as the greatest goalkeeper of his generation. His influence can be seen in every modern goalkeeper who plays with the ball at their feet.',
          image: 'Neuer.jpg'
        }
      ],
      donuts: [{ label: 'Saves', percent: 93 }, { label: 'Clean Sheets', percent: 95 }, { label: 'Reflexes', percent: 90 }]
    },
    {
      name: 'vandijk', full_name: 'Virgil van Dijk', position: 'defender', nationality: 'Netherlands',
      image: 'Van Dijk.jpg', stats_image: 'Van Dijk.jpg', vote_image: 'Van Dijk.jpg',
      stats: [
        { label: 'APPEARANCES', left: 580 },
        { label: 'GOALS', left: 68 },
        { label: 'TROPHIES', left: 12 },
        { label: 'CLEAN SHEETS', left: 210 },
        { label: 'TACKLES WON', left: 420 },
        { label: 'AERIAL DUELS WON', left: 1850 },
        { label: 'INTERNATIONAL CAPS', left: 75 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 1 }
      ],
      bio: [
        {
          title: 'Early Life — Virgil van Dijk',
          text: 'Born on July 8, 1991, in Breda, Netherlands, Virgil van Dijk had an unconventional path to the top. He started at amateur club WDS before joining Willem II\'s academy and then Groningen. Unlike many modern defenders groomed at elite academies, Van Dijk developed his game in the Dutch lower leagues, building the physical and mental resilience that would later define his career. A move to Celtic in 2013 was his first step onto the European stage.',
          image: 'Van Dijk.jpg'
        },
        {
          title: 'The Liverpool Colossus',
          text: 'After impressing at Southampton, Liverpool paid a world-record fee for a defender — £75 million — in January 2018. The impact was immediate and transformative. Van Dijk turned Liverpool from nearly-men into European champions, winning the Champions League in 2019 and the Premier League in 2020. He finished runner-up for the 2019 Ballon d\'Or — the closest a defender had come to winning since Fabio Cannavaro in 2006. His composure, reading of the game, and aerial dominance set a new standard.',
          image: 'Van Dijk.jpg'
        },
        {
          title: 'Legacy — The Complete Defender',
          text: 'Van Dijk proved that defenders can still be the most important players on the pitch. His ability to organize a backline, win aerial duels, and carry the ball out from the back made him the prototype for the modern centre-back. Even after a devastating ACL injury in 2020, he returned to captain both Liverpool and the Netherlands. His legacy is one of quiet authority — a defender who made the extraordinary look routine.',
          image: 'Van Dijk.jpg'
        }
      ],
      donuts: [{ label: 'Defending', percent: 96 }, { label: 'Aerial', percent: 97 }, { label: 'Passing', percent: 88 }]
    },
    {
      name: 'ramos', full_name: 'Sergio Ramos', position: 'defender', nationality: 'Spain',
      image: 'Ramos.jpg', stats_image: 'Ramos.jpg', vote_image: 'Ramos.jpg',
      stats: [
        { label: 'APPEARANCES', left: 850 },
        { label: 'GOALS', left: 135 },
        { label: 'TROPHIES', left: 30 },
        { label: 'CLEAN SHEETS', left: 290 },
        { label: 'TACKLES WON', left: 580 },
        { label: 'AERIAL DUELS WON', left: 2200 },
        { label: 'INTERNATIONAL CAPS', left: 180 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 4 }
      ],
      bio: [
        {
          title: 'Early Life — Sergio Ramos',
          text: 'Born on March 30, 1986, in Camas, Seville, Spain, Sergio Ramos García grew up with football in his blood. He joined Sevilla\'s academy at the age of 14 and was fast-tracked into the first team by 17. His raw aggression, speed, and leadership qualities were evident from the start. In 2005, at just 19, Real Madrid paid €27 million for the young defender — making him one of the most expensive teenagers in football history at the time.',
          image: 'Ramos.jpg'
        },
        {
          title: 'The Real Madrid Legend',
          text: 'Ramos spent 16 years at Real Madrid, becoming the club\'s most iconic defender. His 93rd-minute header in the 2014 Champions League final against Atlético Madrid — "La Décima" — is one of football\'s most famous moments. He went on to win four Champions League titles, four La Liga titles, and two European Championships with Spain. A prolific goalscorer from defence, he netted 101 goals for Real Madrid, an extraordinary number for a centre-back.',
          image: 'Ramos.jpg'
        },
        {
          title: 'Legacy — The Warrior',
          text: 'Sergio Ramos was football\'s ultimate warrior. With 180 caps for Spain, he is the country\'s most-capped player ever, helping win the 2010 World Cup and Euro 2008 and 2012. His combination of defensive intensity, clutch goals, and leadership defined an era at Real Madrid. Though controversial — he holds the record for most red cards in La Liga history — his winning mentality and big-game heroics make him one of the greatest defenders to ever play.',
          image: 'Ramos.jpg'
        }
      ],
      donuts: [{ label: 'Defending', percent: 93 }, { label: 'Aerial', percent: 95 }, { label: 'Leadership', percent: 98 }]
    },
    {
      name: 'neymar', full_name: 'Neymar Jr', position: 'forward', nationality: 'Brazil',
      image: 'Neymar.jpg', stats_image: 'Neymar.jpg', vote_image: 'Neymar.jpg',
      stats: [
        { label: 'GOALS', left: 440 },
        { label: 'ASSISTS', left: 310 },
        { label: 'TOTAL TROPHIES', left: 26 },
        { label: "BALLON D'OR", left: 0 },
        { label: 'EUROPEAN GOLDEN BOOTS', left: 0 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 1 },
        { label: 'INTERNATIONAL GOALS', left: 79 },
        { label: 'WORLD CUPS', left: 0 }
      ],
      bio: [
        {
          title: 'Early Life — Neymar Jr',
          text: 'Born on February 5, 1992, in Mogi das Cruzes, São Paulo, Brazil, Neymar da Silva Santos Júnior grew up in a modest household. His father, a former footballer, recognized his talent early and enrolled him at Santos FC\'s youth academy at age 11. By 17, Neymar was already a first-team regular, dazzling fans with his flair, skill moves, and audacious confidence. He led Santos to the 2011 Copa Libertadores title and was hailed as the heir to Pelé.',
          image: 'Neymar.jpg'
        },
        {
          title: 'The European Chapter',
          text: 'Neymar\'s move to Barcelona in 2013 formed the devastating MSN trident with Messi and Suárez — arguably the greatest attacking trio in football history. Together, they won the 2015 Champions League, with Neymar scoring in the final. In 2017, he made the then-world record €222 million move to Paris Saint-Germain, seeking to step out of Messi\'s shadow. At PSG, he won four Ligue 1 titles and reached the 2020 Champions League final.',
          image: 'Neymar.jpg'
        },
        {
          title: 'Legacy — The Entertainer',
          text: 'Neymar is the most naturally gifted Brazilian footballer since Ronaldinho. His skill, vision, and ability to produce moments of magic made him one of the most watchable players of his generation. Injuries robbed him of consistency, and he never won the Ballon d\'Or, but his impact on Brazilian football — becoming Brazil\'s second-highest all-time scorer — and his role in Barcelona\'s treble-winning season secured his place among the elite.',
          image: 'Neymar.jpg'
        }
      ],
      donuts: [{ label: 'Dribbling', percent: 97 }, { label: 'Creativity', percent: 94 }, { label: 'Flair', percent: 98 }]
    },
    {
      name: 'hazard', full_name: 'Eden Hazard', position: 'forward', nationality: 'Belgium',
      image: 'Hazard.jpg', stats_image: 'Hazard.jpg', vote_image: 'Hazard.jpg',
      stats: [
        { label: 'GOALS', left: 170 },
        { label: 'ASSISTS', left: 186 },
        { label: 'TOTAL TROPHIES', left: 13 },
        { label: "BALLON D'OR", left: 0 },
        { label: 'EUROPEAN GOLDEN BOOTS', left: 0 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 0 },
        { label: 'INTERNATIONAL GOALS', left: 33 },
        { label: 'WORLD CUPS', left: 0 }
      ],
      bio: [
        {
          title: 'Early Life — Eden Hazard',
          text: 'Born on January 7, 1991, in La Louvière, Belgium, Eden Michael Hazard came from a footballing family — both his parents were semi-professional players. He joined the Tubize academy at age four before moving to French club Lille at 14. His talent was so obvious that Lille accelerated his development, and by 16, he was making his professional debut. He won back-to-back Ligue 1 Young Player of the Year awards and the league title before turning 21.',
          image: 'Hazard.jpg'
        },
        {
          title: 'The Chelsea King',
          text: 'Hazard arrived at Chelsea in 2012 and quickly became the best player in the Premier League. His low centre of gravity, electric dribbling, and ability to glide past defenders made him almost impossible to stop. He won two Premier League titles (2015, 2017), two Europa League titles, and was named PFA Player of the Year. His final season at Chelsea — 2018-19 with 21 goals and 17 assists — was arguably the finest individual campaign by any Chelsea player.',
          image: 'Hazard.jpg'
        },
        {
          title: 'Legacy — What Could Have Been',
          text: 'Hazard\'s €100 million move to Real Madrid in 2019 was meant to be the crowning chapter of his career. Instead, persistent injuries limited him to just 76 appearances in four years, with only seven goals. He retired in 2023 at just 32. Despite the Madrid heartbreak, Hazard\'s legacy at Chelsea is untouchable — he was the Premier League\'s most elegant player of the 2010s. For Belgium, he captained the "Golden Generation" to a World Cup semi-final in 2018.',
          image: 'Hazard.jpg'
        }
      ],
      donuts: [{ label: 'Dribbling', percent: 95 }, { label: 'Creativity', percent: 91 }, { label: 'Vision', percent: 89 }]
    },
    {
      name: 'mbappe', full_name: 'Kylian Mbappé', position: 'forward', nationality: 'France',
      image: 'Mbappe.jpg', stats_image: 'Mbappe.jpg', vote_image: 'Mbappe.jpg',
      stats: [
        { label: 'GOALS', left: 310 },
        { label: 'ASSISTS', left: 120 },
        { label: 'TOTAL TROPHIES', left: 19 },
        { label: "BALLON D'OR", left: 0 },
        { label: 'EUROPEAN GOLDEN BOOTS', left: 0 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 0 },
        { label: 'INTERNATIONAL GOALS', left: 48 },
        { label: 'WORLD CUPS', left: 1 }
      ],
      bio: [
        {
          title: 'Early Life — Kylian Mbappé',
          text: 'Born on December 20, 1998, in Bondy, a suburb of Paris, Kylian Mbappé Lottin was immersed in football from birth — his father was a football coach and his mother a former handball player. He joined AS Bondy at age six, and by 11, his talent had attracted attention from every major European club. Real Madrid famously invited the 14-year-old for a trial. He chose Monaco\'s academy, and at 16, he became the youngest player to score for the club since Thierry Henry.',
          image: 'Mbappe.jpg'
        },
        {
          title: 'The Phenomenon',
          text: 'Mbappé\'s breakthrough at Monaco in 2016-17, where he helped them win Ligue 1 and reach the Champions League semi-finals at just 18, announced a generational talent. His €180 million move to PSG made him the second-most expensive player ever. In 2018, at 19, he became the second teenager after Pelé to score in a World Cup final, winning the tournament with France. At PSG, he became the club\'s all-time leading scorer with over 250 goals.',
          image: 'Mbappe.jpg'
        },
        {
          title: 'Legacy — The Next Generation',
          text: 'Mbappé represents the future of football. His explosive pace, clinical finishing, and big-game mentality have drawn comparisons to Ronaldo (the Brazilian). His hat-trick in the 2022 World Cup final — including two goals in 97 seconds — is one of the greatest individual performances in any match, ever. His move to Real Madrid in 2024 fulfilled a childhood dream. At 25, he has already achieved more than most players do in a career.',
          image: 'Mbappe.jpg'
        }
      ],
      donuts: [{ label: 'Pace', percent: 99 }, { label: 'Finishing', percent: 93 }, { label: 'Big Games', percent: 95 }]
    },
    {
      name: 'haaland', full_name: 'Erling Haaland', position: 'forward', nationality: 'Norway',
      image: 'Haland.jpg', stats_image: 'Haland.jpg', vote_image: 'Haland.jpg',
      stats: [
        { label: 'GOALS', left: 280 },
        { label: 'ASSISTS', left: 52 },
        { label: 'TOTAL TROPHIES', left: 12 },
        { label: "BALLON D'OR", left: 0 },
        { label: 'EUROPEAN GOLDEN BOOTS', left: 1 },
        { label: 'CHAMPIONS LEAGUE TITLES', left: 1 },
        { label: 'INTERNATIONAL GOALS', left: 35 },
        { label: 'WORLD CUPS', left: 0 }
      ],
      bio: [
        {
          title: 'Early Life — Erling Haaland',
          text: 'Born on July 21, 2000, in Leeds, England, while his father Alfie Haaland played for Leeds United, Erling Braut Haaland grew up in Bryne, Norway. He joined Bryne FK\'s academy and later moved to Molde, where he was coached by Ole Gunnar Solskjær. His physical development was extraordinary — by 16, he was already 6\'4" with explosive speed. A breakthrough at Red Bull Salzburg, where he scored 28 goals in 22 games, put every top club on alert.',
          image: 'Haland.jpg'
        },
        {
          title: 'The Goal Machine',
          text: 'Haaland chose Borussia Dortmund in January 2020 and immediately delivered: a hat-trick on his debut. In 89 games for Dortmund, he scored 86 goals — a ratio that defied belief. His 2022 move to Manchester City produced one of the most remarkable debut seasons in football history: 52 goals in 53 games, winning the treble. He broke the Premier League single-season goal record with 36 goals, and his Champions League final goal sealed City\'s first-ever European trophy.',
          image: 'Haland.jpg'
        },
        {
          title: 'Legacy — The Record Breaker',
          text: 'At just 24, Haaland has already rewritten the record books. He is the fastest player to 50 Champions League goals, the Premier League single-season record holder, and a treble winner. His combination of size, speed, and lethal finishing makes him unlike any striker before him. With Norway unlikely to qualify for major tournaments, his legacy will be defined by club achievements — and at Manchester City, he has only just begun.',
          image: 'Haland.jpg'
        }
      ],
      donuts: [{ label: 'Finishing', percent: 98 }, { label: 'Power', percent: 96 }, { label: 'Movement', percent: 94 }]
    }
  ];

  const duosData = [
    {
      slug: 'messi-x-cristiano', title: 'Messi X Cristiano', p1: 'messi', p2: 'ronaldo', hasTimeline: 1,
      comparison: {
        player1: { number: '01', name: 'Lionel Messi', peakYears: '2009–2015', body: 'Lionel Messi\'s rivalry with Cristiano Ronaldo peaked between 2009 and 2015 during their time at Barcelona and Real Madrid. In this period, Messi won four consecutive Ballon d\'Or awards (2009–2012) and consistently led La Liga in goals and assists. His playing style is defined by close control, spatial awareness, and playmaking ability, often operating between lines to create scoring opportunities. His impact extended beyond goals, shaping Barcelona\'s positional dominance during their most successful era.' },
        player2: { number: '02', name: 'Cristiano Ronaldo', peakYears: '2011–2018', body: 'Cristiano Ronaldo\'s peak rivalry years spanned roughly 2011 to 2018, particularly during his second tenure at Real Madrid. He won four Ballon d\'Or awards in that period and became the all-time leading scorer in UEFA Champions League history. Ronaldo\'s profile is defined by athleticism, aerial ability, and goal efficiency. Unlike Messi\'s playmaking-heavy influence, Ronaldo\'s role evolved into that of a decisive finisher in high-pressure matches.' }
      }
    },
    {
      slug: 'courtois-x-neuer', title: 'Courtois X Neuer', p1: 'courtois', p2: 'neuer', hasTimeline: 0,
      comparison: {
        player1: { number: '01', name: 'Thibaut Courtois', peakYears: '2018–2023', body: 'Thibaut Courtois represents the modern shot-stopping goalkeeper at its finest. His peak at Real Madrid, particularly the 2021-22 Champions League campaign where he made 59 saves across the knockout rounds, was a masterclass in reflexes and positioning. At 6\'6", he covers the goal like few others, combining his imposing frame with exceptional agility. His nine saves in the 2022 Champions League final against Liverpool remain the most in any final this century.' },
        player2: { number: '02', name: 'Manuel Neuer', peakYears: '2012–2016', body: 'Manuel Neuer revolutionized goalkeeping itself. His peak, from 2012 to 2016 under Pep Guardiola at Bayern Munich, saw him redefine the position — rushing out to sweep behind the defensive line, playing as an extra outfield player in possession, and commanding his box with unmatched authority. His 2014 World Cup Golden Glove performance, where Germany conceded just four goals in seven games, cemented his status as the greatest goalkeeper of his generation.' }
      }
    },
    {
      slug: 'van-dijk-x-ramos', title: 'Van Dijk X Ramos', p1: 'vandijk', p2: 'ramos', hasTimeline: 0,
      comparison: {
        player1: { number: '01', name: 'Virgil van Dijk', peakYears: '2018–2020', body: 'Virgil van Dijk\'s peak coincided with Liverpool\'s rise to the top of European football. Between 2018 and 2020, he was virtually unbeatable in one-on-one situations, going an extraordinary 64 Premier League matches without being dribbled past. His composure on the ball, ability to read the game, and commanding aerial presence transformed Liverpool into Champions League winners and Premier League champions. He finished runner-up for the 2019 Ballon d\'Or — a testament to his dominance.' },
        player2: { number: '02', name: 'Sergio Ramos', peakYears: '2014–2018', body: 'Sergio Ramos was the heartbeat of Real Madrid\'s Champions League dynasty between 2014 and 2018. His ability to produce decisive moments in the biggest matches is unmatched by any defender in history — from his 93rd-minute equalizer in the 2014 final to his leadership in four European triumphs in five years. Ramos combined old-school defensive aggression with modern ball-playing ability, making him the most complete centre-back of the 2010s and Spain\'s most-capped player ever.' }
      }
    },
    {
      slug: 'neymar-x-hazard', title: 'Neymar X Hazard', p1: 'neymar', p2: 'hazard', hasTimeline: 0,
      comparison: {
        player1: { number: '01', name: 'Neymar Jr', peakYears: '2014–2018', body: 'Neymar\'s peak saw him as arguably the third-best player on the planet. At Barcelona alongside Messi and Suárez, the MSN trident terrorized Europe, winning the 2015 treble. His move to PSG for a record €222 million was meant to elevate him to the very top. At his best, Neymar combined Brazilian flair with devastating end product — his dribbling success rate and chance creation numbers rivalled anyone in the world. Injuries limited his consistency, but on his day, he was unplayable.' },
        player2: { number: '02', name: 'Eden Hazard', peakYears: '2014–2019', body: 'Eden Hazard at Chelsea was pure football poetry. Between 2014 and 2019, he was the Premier League\'s most dangerous attacker — his low centre of gravity and ability to change direction at full speed made him a nightmare for defenders. His 2018-19 farewell season (21 goals, 17 assists) was his masterpiece. While Neymar had Messi beside him, Hazard carried Chelsea single-handedly, making him arguably the more impressive performer relative to his supporting cast.' }
      }
    },
    {
      slug: 'mbappe-x-haaland', title: 'Mbappe X Haland', p1: 'mbappe', p2: 'haaland', hasTimeline: 0,
      comparison: {
        player1: { number: '01', name: 'Kylian Mbappé', peakYears: '2020–Present', body: 'Kylian Mbappé is the most complete young forward in football. His pace is legendary — timed at over 36 km/h in full sprint — but it\'s his intelligence, movement, and finishing that elevate him. A World Cup winner at 19, a World Cup final hat-trick scorer at 23, and PSG\'s all-time leading scorer, Mbappé has already written himself into football history. His 2024 move to Real Madrid positions him to dominate the next decade of European football.' },
        player2: { number: '02', name: 'Erling Haaland', peakYears: '2022–Present', body: 'Erling Haaland is a goal-scoring anomaly. His debut season at Manchester City — 52 goals in 53 games, a treble, and the Premier League single-season record — was the most prolific first season in English football history. While Mbappé creates and scores, Haaland is a pure finisher — his movement, timing, and lethal efficiency in the box make him the deadliest striker since Ronaldo (the Brazilian). At 24, his Champions League goals-per-game ratio is the best in the competition\'s history.' }
      }
    }
  ];

  const insertAll = db.transaction(() => {
    const playerIds = {};
    for (const p of players) {
      const result = insertPlayer.run(
        p.name, p.full_name, p.position, p.nationality,
        p.image, p.stats_image, p.vote_image,
        JSON.stringify(p.stats), JSON.stringify(p.bio), JSON.stringify(p.donuts)
      );
      playerIds[p.name] = result.lastInsertRowid;
    }

    for (const d of duosData) {
      insertDuo.run(
        d.slug, d.title,
        playerIds[d.p1], playerIds[d.p2],
        JSON.stringify(d.comparison),
        d.hasTimeline
      );
    }
  });

  insertAll();
  console.log('Database seeded with 10 players and 5 duos');
}

seedDatabase();

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.use(express.static(__dirname));

// --- Google OAuth client ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login required' });
  }
  next();
}

// --- Auth routes ---

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { firstName, lastName, dob, gender, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'First name, last name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (first_name, last_name, dob, gender, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(firstName, lastName, dob || null, gender || null, email, passwordHash);
    req.session.userId = result.lastInsertRowid;
    res.json({ user: { id: result.lastInsertRowid, firstName, lastName, email } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    req.session.userId = user.id;
    res.json({ user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential required' });
    }
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const firstName = payload.given_name || payload.name || '';
    const lastName = payload.family_name || '';
    let user = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, email);
    if (!user) {
      const result = db.prepare(
        'INSERT INTO users (first_name, last_name, email, google_id) VALUES (?, ?, ?, ?)'
      ).run(firstName, lastName, email, googleId);
      user = { id: result.lastInsertRowid, first_name: firstName, last_name: lastName, email };
    } else if (!user.google_id) {
      db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(googleId, user.id);
    }
    req.session.userId = user.id;
    res.json({ user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email } });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => { res.json({ ok: true }); });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const user = db.prepare('SELECT id, first_name, last_name, email FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email } });
});

// --- Duo routes ---

app.get('/api/duos', (req, res) => {
  const duos = db.prepare('SELECT id, slug, title, has_timeline as hasTimeline FROM duos').all();
  res.json(duos);
});

app.get('/api/duos/:slug', (req, res) => {
  const duo = db.prepare(`
    SELECT d.id, d.slug, d.title, d.has_timeline as hasTimeline, d.comparison_json,
      d.player1_id, d.player2_id
    FROM duos d WHERE d.slug = ?
  `).get(req.params.slug);

  if (!duo) return res.status(404).json({ error: 'Duo not found' });

  const p1 = db.prepare('SELECT * FROM players WHERE id = ?').get(duo.player1_id);
  const p2 = db.prepare('SELECT * FROM players WHERE id = ?').get(duo.player2_id);

  const formatPlayer = (p) => ({
    id: p.id, name: p.name, fullName: p.full_name, position: p.position,
    nationality: p.nationality, image: p.image, statsImage: p.stats_image,
    voteImage: p.vote_image,
    stats: JSON.parse(p.stats_json), bio: JSON.parse(p.bio_json), donuts: JSON.parse(p.donut_json)
  });

  res.json({
    id: duo.id, slug: duo.slug, title: duo.title, hasTimeline: !!duo.hasTimeline,
    comparison: JSON.parse(duo.comparison_json),
    player1: formatPlayer(p1),
    player2: formatPlayer(p2)
  });
});

// --- Duo vote routes ---

app.post('/api/duos/:slug/vote', requireAuth, (req, res) => {
  const { playerId } = req.body;
  const duo = db.prepare('SELECT id, player1_id, player2_id FROM duos WHERE slug = ?').get(req.params.slug);
  if (!duo) return res.status(404).json({ error: 'Duo not found' });
  if (playerId !== duo.player1_id && playerId !== duo.player2_id) {
    return res.status(400).json({ error: 'Invalid player for this duo' });
  }
  const existing = db.prepare('SELECT player_id FROM duo_votes WHERE user_id = ? AND duo_id = ?').get(req.session.userId, duo.id);
  if (existing) {
    return res.status(409).json({ error: 'You have already voted', playerId: existing.player_id });
  }
  db.prepare('INSERT INTO duo_votes (user_id, duo_id, player_id) VALUES (?, ?, ?)').run(req.session.userId, duo.id, playerId);

  const counts = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN player_id = ? THEN 1 ELSE 0 END), 0) as player1Count,
      COALESCE(SUM(CASE WHEN player_id = ? THEN 1 ELSE 0 END), 0) as player2Count
    FROM duo_votes WHERE duo_id = ?
  `).get(duo.player1_id, duo.player2_id, duo.id);

  res.json({ ok: true, playerId, counts });
});

app.get('/api/duos/:slug/vote/counts', (req, res) => {
  const duo = db.prepare('SELECT id, player1_id, player2_id FROM duos WHERE slug = ?').get(req.params.slug);
  if (!duo) return res.status(404).json({ error: 'Duo not found' });

  const counts = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN player_id = ? THEN 1 ELSE 0 END), 0) as player1Count,
      COALESCE(SUM(CASE WHEN player_id = ? THEN 1 ELSE 0 END), 0) as player2Count
    FROM duo_votes WHERE duo_id = ?
  `).get(duo.player1_id, duo.player2_id, duo.id);

  res.json(counts);
});

app.get('/api/duos/:slug/vote/mine', requireAuth, (req, res) => {
  const duo = db.prepare('SELECT id FROM duos WHERE slug = ?').get(req.params.slug);
  if (!duo) return res.status(404).json({ error: 'Duo not found' });
  const vote = db.prepare('SELECT player_id FROM duo_votes WHERE user_id = ? AND duo_id = ?').get(req.session.userId, duo.id);
  res.json({ playerId: vote ? vote.player_id : null });
});

// --- Comment routes ---

app.get('/api/duos/:slug/comments', (req, res) => {
  const duo = db.prepare('SELECT id FROM duos WHERE slug = ?').get(req.params.slug);
  if (!duo) return res.status(404).json({ error: 'Duo not found' });

  const since = parseInt(req.query.since) || 0;
  const comments = db.prepare(`
    SELECT c.id, c.content, c.created_at as createdAt, u.first_name as userName
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.duo_id = ? AND c.id > ?
    ORDER BY c.created_at DESC LIMIT 50
  `).all(duo.id, since);

  res.json(comments);
});

app.post('/api/duos/:slug/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Comment cannot be empty' });
  }
  if (content.length > 280) {
    return res.status(400).json({ error: 'Comment too long (max 280 characters)' });
  }
  const duo = db.prepare('SELECT id FROM duos WHERE slug = ?').get(req.params.slug);
  if (!duo) return res.status(404).json({ error: 'Duo not found' });

  const user = db.prepare('SELECT first_name FROM users WHERE id = ?').get(req.session.userId);
  const result = db.prepare('INSERT INTO comments (user_id, duo_id, content) VALUES (?, ?, ?)').run(req.session.userId, duo.id, content.trim());

  res.json({
    id: result.lastInsertRowid,
    content: content.trim(),
    createdAt: new Date().toISOString(),
    userName: user.first_name
  });
});

// --- Legacy vote routes (backward compat) ---
app.post('/api/vote', requireAuth, (req, res) => {
  const { player } = req.body;
  if (!player || !['messi', 'ronaldo'].includes(player)) {
    return res.status(400).json({ error: 'Invalid player' });
  }
  const existing = db.prepare('SELECT player FROM votes WHERE user_id = ?').get(req.session.userId);
  if (existing) {
    return res.status(409).json({ error: 'You have already voted', vote: existing.player });
  }
  db.prepare('INSERT INTO votes (user_id, player) VALUES (?, ?)').run(req.session.userId, player);
  const counts = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN player = 'messi' THEN 1 ELSE 0 END), 0) AS messi, COALESCE(SUM(CASE WHEN player = 'ronaldo' THEN 1 ELSE 0 END), 0) AS ronaldo FROM votes"
  ).get();
  res.json({ ok: true, vote: player, counts });
});

app.get('/api/vote/counts', (req, res) => {
  const counts = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN player = 'messi' THEN 1 ELSE 0 END), 0) AS messi, COALESCE(SUM(CASE WHEN player = 'ronaldo' THEN 1 ELSE 0 END), 0) AS ronaldo FROM votes"
  ).get();
  res.json(counts);
});

app.get('/api/vote/mine', requireAuth, (req, res) => {
  const vote = db.prepare('SELECT player FROM votes WHERE user_id = ?').get(req.session.userId);
  res.json({ vote: vote ? vote.player : null });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
