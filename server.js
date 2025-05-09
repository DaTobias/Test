require('dotenv').config();
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();

// === Middleware ===
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Stellt sicher, dass 'public' korrekt bedient wird

// === Spotify API Setup ===
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI
});

// === Zugriffstoken holen ===
async function initSpotifyToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body.access_token);
    console.log('✅ Spotify Access Token gesetzt');
  } catch (err) {
    console.error('❌ Fehler beim Abrufen des Tokens:', err);
  }
}

// Initiales Token setzen und alle 50 Minuten erneuern
initSpotifyToken();
setInterval(initSpotifyToken, 50 * 60 * 1000); // Alle 50 Minuten neu

// === Spotify OAuth ===
const scopes = [
  'user-read-private',
  'user-read-email',
  'user-library-read',
  'user-top-read'
];

// Login Endpoint
app.get('/login', (req, res) => {
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'some-state');
  res.redirect(authorizeURL); // Weiterleitung zur Spotify-Login-Seite
});

// Redirect Endpoint nach erfolgreichem Login
app.get('/spotify-redirect', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Kein Code erhalten.');

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const access_token = data.body.access_token;
    const refresh_token = data.body.refresh_token;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // Weiterleitung zur Index-Seite mit dem Access Token
    res.redirect(`${process.env.URI}/index.html?access_token=${access_token}`);
  } catch (err) {
    console.error('❌ Fehler bei Auth:', err);
    res.status(400).send('Spotify Auth fehlgeschlagen');
  }
});

// Profile Endpoint
app.get('/profile', async (req, res) => {
  const accessToken = req.query.access_token;  // Zugriff auf das Token aus der URL

  if (!accessToken) {
    return res.status(400).send("Kein Access Token erhalten");
  }

  spotifyApi.setAccessToken(accessToken);

  try {
    // Versuche, das Profil abzurufen
    const response = await spotifyApi.getMe();
    const user = response.body;
    const profileData = {
      name: user.display_name,
      email: user.email,
      followers: user.followers.total,
      image: user.images.length > 0 ? user.images[0].url : null,
      topArtists: [],  // Dies kannst du später mit den Top-Künstlern ausfüllen
      topTracks: []    // Dies kannst du später mit den Top-Tracks ausfüllen
    };

    // Optional: Top Artists und Tracks hinzufügen
    const topArtistsResponse = await spotifyApi.getMyTopArtists();
    profileData.topArtists = topArtistsResponse.body.items;

    const topTracksResponse = await spotifyApi.getMyTopTracks();
    profileData.topTracks = topTracksResponse.body.items;

    res.json(profileData);  // Rückgabe der Profildaten
  } catch (error) {
    console.error("Fehler beim Abrufen der Profildaten:", error);
    res.status(500).send("Fehler beim Abrufen der Profildaten");
  }
});

// Suche nach Künstlern auf Spotify
app.get('/search', async (req, res) => {
  const query = req.query.q;  // Künstlername aus der Anfrage holen
  const accessToken = req.query.access_token;

  if (!accessToken || !query) {
    return res.status(400).send("Kein Access Token oder keine Suchanfrage erhalten.");
  }

  spotifyApi.setAccessToken(accessToken);

  try {
    // Suche nach dem Künstler in der Spotify API
    const response = await spotifyApi.searchArtists(query);
    res.json(response.body.artists.items);  // Rückgabe der Künstlerdaten
  } catch (error) {
    console.error("Fehler bei der Suche:", error);
    res.status(500).send("Fehler bei der Suche nach Künstlern.");
  }
});

// Suche nach Songs auf Spotify
app.get('/search/songs', async (req, res) => {
  const query = req.query.q;  // Songname aus der Anfrage holen
  const accessToken = req.query.access_token;

  if (!accessToken || !query) {
    return res.status(400).send("Kein Access Token oder keine Suchanfrage erhalten.");
  }

  spotifyApi.setAccessToken(accessToken);

  try {
    // Suche nach Songs in der Spotify API
    const response = await spotifyApi.searchTracks(query);
    res.json(response.body.tracks.items);  // Rückgabe der Songdaten
  } catch (error) {
    console.error("Fehler bei der Song-Suche:", error);
    res.status(500).send("Fehler bei der Suche nach Songs.");
  }
});

// Lieblingssongs oder zuletzt gehörte Tracks abrufen
// Im Backend (Node.js) sicherstellen, dass die Rückgabe korrekt ist
/*app.get("/my-songs", async (req, res) => {
  const accessToken = req.query.access_token;

  if (!accessToken) {
    return res.status(400).json({ error: "Kein Access Token erhalten." });
  }

  spotifyApi.setAccessToken(accessToken);

  try {
    const response = await spotifyApi.getMySavedTracks();
    const songs = response.body.items.map(item => {
      return {
        id: item.track?.id,
        name: item.track?.name,
        artists: item.track?.artists?.map(artist => artist.name)?.join(', '),
        album: item.track?.album?.name,
        image: item.track?.album?.images?.[0]?.url,
        preview_url: item.track?.preview_url,
        spotify: item.track?.external_urls?.spotify
      };
    }).filter(item => item.id); // Nur gültige Songs behalten

    res.json(songs);
  } catch (error) {
    console.error("Fehler beim Abrufen der Songs:", error);
    res.status(500).json({ error: "Fehler beim Abrufen der Songs" });
  }
});*/

app.get("/my-top-tracks", async (req, res) => {
  const accessToken = req.query.access_token;
  const timeRange = req.query.time_range || 'medium_term';
  const limit = parseInt(req.query.limit) || 20;

  if (!accessToken) {
    return res.status(400).json({ 
      success: false,
      error: "Access Token fehlt" 
    });
  }

  try {
    // Setze den Access Token für die API
    spotifyApi.setAccessToken(accessToken);

    // Hole die Top-Tracks von Spotify
    const { body } = await spotifyApi.getMyTopTracks({
      time_range: timeRange,
      limit: limit
    });

    // Verarbeite die Tracks
    const tracks = body.items.map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(artist => ({
        id: artist.id,
        name: artist.name,
        url: artist.external_urls.spotify
      })),
      album: {
        name: track.album.name,
        image: track.album.images[0]?.url,
        url: track.album.external_urls.spotify
      },
      preview_url: track.preview_url,
      spotify_url: track.external_urls.spotify,
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      explicit: track.explicit
    }));

    res.json({
      success: true,
      time_range: timeRange,
      limit: limit,
      tracks: tracks
    });

  } catch (error) {
    console.error("Spotify API Fehler:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// HTTPS Server starten
const PORT = process.env.PORT || 3000;
const credentials = {
  pfx: fs.readFileSync(process.env.PFX_PATH),
  passphrase: process.env.PFX_PASSPHRASE
};

https.createServer(credentials, app).listen(PORT, () => {
  console.log(`✅ Server läuft unter https://localhost:${PORT}`);
});
