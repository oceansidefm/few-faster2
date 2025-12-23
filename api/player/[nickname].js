// Load environment variables locally


const FACEIT_API_KEY = "855ef453-e82a-40dc-8d4e-f7aa0ab9894d";


import 'dotenv/config'; // if using CommonJS, use: require('dotenv').config();

// Simple in-memory cache for 1 minute
const cache = new Map();
const CACHE_TTL = 60 * 1000;

export default async function handler(req, res) {
  const { nickname } = req.query;

  if (!nickname) {
    return res.status(400).json({ error: "Missing nickname" });
  }

  // Return cached data if valid
  const cached = cache.get(nickname.toLowerCase());
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  const apiKey = FACEIT_API_KEY;
  if (!apiKey) {
    console.error("FACEIT_API_KEY not set");
    return res.status(500).json({ error: "API key not set" });
  }

  const headers = { Authorization: `Bearer ${apiKey}` };

  try {
    // 1️⃣ Get player info
    const playerRes = await fetch(
      `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`,
      { headers }
    );

    if (playerRes.status === 404) {
      return res.status(404).json({ error: "Player not found" });
    }

    if (!playerRes.ok) {
      return res.status(playerRes.status).json({ error: "Faceit API error" });
    }

    const playerData = await playerRes.json();
    const playerId = playerData.player_id;

    // 2️⃣ Fetch last 10 matches
    const historyRes = await fetch(
      `https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=10`,
      { headers }
    );

    if (!historyRes.ok) {
      throw new Error("Failed to fetch match history");
    }

    const historyData = await historyRes.json();
    const matchIds = historyData.items.map((m) => m.match_id);

    // 3️⃣ Fetch match stats in parallel
    const statsResults = await Promise.all(
      matchIds.map((id) =>
        fetch(`https://open.faceit.com/data/v4/matches/${id}/stats`, { headers })
          .then((r) => (r.ok ? r.json() : null))
      )
    );

    // 4️⃣ Calculate average K/D
    let totalKills = 0,
      totalDeaths = 0,
      gamesCounted = 0;

    for (const stats of statsResults) {
      if (!stats) continue;

      for (const team of stats.rounds[0].teams) {
        const player = team.players.find((p) => p.player_id === playerId);
        if (player) {
          totalKills += Number(player.player_stats.Kills);
          totalDeaths += Number(player.player_stats.Deaths);
          gamesCounted++;
        }
      }
    }

    const avgKD = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : "N/A";

    const result = {
      nickname: playerData.nickname,
      elo: playerData.games?.cs2?.faceit_elo ?? "N/A",
      skill_level: playerData.games?.cs2?.skill_level ?? 1,
      average_kd: avgKD,
    };

    // Save to cache
    cache.set(nickname.toLowerCase(), { data: result, time: Date.now() });

    res.status(200).json(result);
  } catch (err) {
    console.error("API ERROR:", err);
    res.status(500).json({ error: "Server error or invalid API key" });
  }
}
