import express from "express";
import pg from "pg";
import path from "path";
import bcrypt from "bcrypt";
import session from "express-session"; // Added for sessions
import { fileURLToPath } from 'url';
import flash from 'connect-flash';
import dotenv from 'dotenv';

dotenv.config(); 


// ES Module workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;

// Database Client Setup
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// const db = new pg.Client({
//   user: 'postgres',
//   host: 'localhost',
//   database: 'GyanGanga',
//   password: '12345', // Replace with your actual password
//   port: 5432,
// });

// First, connect to the database
db.connect((err) => {
  if (err) {
    console.error("🔴 FATAL: Database connection error. Server has not started.", err.stack);
    return;
  }
  
  console.log("🟢 Successfully connected to the database.");

  // --- Configuration & Middleware ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

  // Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Session Middleware Configuration
app.use(session({
  secret: 'GyanGangaSecretKey', // Change this to a random string
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 // Cookie expires in 1 day
  }
}));
app.use(flash());

// --- Helper Functions for Database Logic ---

async function handleSignup(fullName, username, email, password, role) {
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const result = await db.query(
      "INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [fullName, username, email, hashedPassword, role]
    );
    console.log("✅ New user created:", result.rows[0]);
    return { success: true };
  } catch (err) {
    console.error("❌ Error during signup:", err.message);
    return { success: false, error: err };
  }
}

async function handleLogin(username, password) {
  try {
    const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return { success: false };
    }
    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (passwordMatch) {
      return { success: true, user: user };
    } else {
      return { success: false };
    }
  } catch (err) {
    console.error("❌ Error during login:", err);
    return { success: false, error: err };
  }
}

// --- Routes ---
app.get('/', (req, res) => {
if (req.session.user) {
  // Check the user's role
  if (req.session.user.role === 'teacher') {
    res.render('teacher_dashboard', { user: req.session.user });
  } else {
    res.render('home', { user: req.session.user }); // Student homepage
  }
} else {
  // If no user is logged in, render the public landing page
  res.render('index', { user: null });
}
});

// UPDATED: Dashboard route also forks based on user role
app.get('/dashboard', (req, res) => {
if (req.session.user) {
  if (req.session.user.role === 'teacher') {
    res.render('teacher_dashboard', { user: req.session.user });
  } else {
    // Student dashboard (the stats page)
    
    // We'll use mock data for now, as in the previous step
    const courseProgressData = {
      maths: 75,
      science: 50,
      technology: 90,
      engineering: 25,
    };
    res.render('dashboard', { 
      user: req.session.user,
      progress: courseProgressData
    });
  }
} else {
  res.redirect('/login');
}
});

// Static routes for login/signup pages
app.get('/login', (req, res) => {
// Pass any flash messages to the template
res.render('login', { messages: req.flash() }); 
});

app.get('/signup', (req, res) => {
// Pass any flash messages to the template
res.render('register', { messages: req.flash() });
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return console.error(err);
    }
    res.redirect('/'); // Redirect to homepage after logout
  });
});

app.post('/signup', async (req, res) => {
const { fullName, username, email, password, role } = req.body;
const result = await handleSignup(fullName, username, email, password, role);

if (result.success) {
  req.flash('success', 'Registration successful! You can now log in.');
  res.redirect('/login');
} else {
  req.flash('error', 'An error occurred. The username or email may be taken.');
  res.redirect('/signup');
}
});

app.post('/login', async (req, res) => {
const { username, password } = req.body;
const result = await handleLogin(username, password);

if (result.success) {
  req.session.user = result.user;
  res.redirect('/');
} else {
  req.flash('error', 'Invalid username or password.');
  res.redirect('/login');
}
});

// GET Route to display the profile page
app.get('/profile', async (req, res) => {
  // Check if the user is logged in
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    // Fetch the latest user data from the database
    const result = await db.query("SELECT * FROM users WHERE id = $1", [req.session.user.id]);
    const currentUser = result.rows[0];
    
    // Render the profile page with the user's data
    res.render('profile', { user: currentUser });
  } catch (err) {
    console.error("Error fetching user for profile:", err);
    res.redirect('/');
  }
});

// POST Route to update the user's profile
app.post('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  // Get the form data from the request body
  const { fullName, email, phoneNumber, schoolName, grade, city } = req.body;
  const userId = req.session.user.id;

  try {
    // Update the user's data in the database
    await db.query(
      `UPDATE users 
       SET full_name = $1, email = $2, phone_number = $3, school_name = $4, grade = $5, city = $6 
       WHERE id = $7`,
      [fullName, email, phoneNumber, schoolName, grade, city, userId]
    );

    // IMPORTANT: Update the session data as well so the header shows the new name
    req.session.user.full_name = fullName;
    
    // Redirect back to the profile page to show the changes
    res.redirect('/profile');
  } catch (err) {
    console.error("Error updating profile:", err);
    // Optionally, you could use connect-flash here to show an error message
    res.redirect('/profile');
  }
});

app.get('/courses/:category', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const category = req.params.category;
  
  try {
    const result = await db.query(
      "SELECT * FROM topics WHERE category = $1 ORDER BY grade_level, topic_name", 
      [category]
    );
    const topics = result.rows;
    
    // Render the new template, passing the topics and category name
    res.render('course_category', { 
      user: req.session.user, 
      topics: topics, 
      category: category 
    });
  } catch (err) {
    console.error("Error fetching course topics:", err);
    res.redirect('/');
  }
});

// NEW: Mission Playback Route
app.get('/mission/:id', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const missionId = parseInt(req.params.id);

    try {
        // Fetch the current mission details
        const missionResult = await db.query(
            "SELECT m.*, t.topic_name, t.grade_level FROM missions m JOIN topics t ON m.topic_id = t.id WHERE m.id = $1",
            [missionId]
        );
        if (missionResult.rows.length === 0) {
            return res.status(404).send('Mission not found!');
        }
        const currentMission = missionResult.rows[0];

        // Fetch all videos for this mission, ordered
        const videosResult = await db.query(
            "SELECT * FROM videos WHERE mission_id = $1 ORDER BY video_order, language, quality",
            [missionId]
        );
        const videos = videosResult.rows;

        // Fetch all missions for the same topic (for "Upcoming Missions")
        const topicMissionsResult = await db.query(
            "SELECT id, mission_title, mission_order FROM missions WHERE topic_id = $1 ORDER BY mission_order",
            [currentMission.topic_id]
        );
        const allTopicMissions = topicMissionsResult.rows;

        // Determine current video (for now, just the first video of the mission)
        // In a real app, you'd store/retrieve the user's progress to know which video to play next.
        const currentVideo = videos.find(v => v.video_order === 1 && v.language === 'english' && v.quality === '720p') || videos[0];


        res.render('mission', {
            user: req.session.user,
            currentMission: currentMission,
            videos: videos, // All videos for the current mission
            currentVideo: currentVideo, // The video currently playing
            allTopicMissions: allTopicMissions // All missions in the topic
        });

    } catch (err) {
        console.error("Error fetching mission details:", err);
        res.status(500).send('Error loading mission.');
    }
});

app.get('/teacher/create-assessment', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  try {
    // We need to fetch the teacher's classrooms to let them choose
    const classroomsResult = await db.query(
      "SELECT * FROM classrooms WHERE teacher_id = $1", 
      [req.session.user.id]
    );
    
    // Pass flash messages to the template so the partial can read `messages` safely
    res.render('create_assessment', { 
      user: req.session.user, 
      classrooms: classroomsResult.rows,
      messages: req.flash()
    });

  } catch (err) {
    console.error("Error loading assessment page:", err);
    res.redirect('/dashboard');
  }
});

// POST Route to save the new assessment and all its questions
app.post('/teacher/create-assessment', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const { title, description, classroom_id, assessment_type, due_date } = req.body;
  const questions = req.body.questions || [];

  try {
    let assessmentTable = '';
    
    // 1. Determine which "container" table to use
    if (assessment_type === 'quiz') assessmentTable = 'quizzes';
    else if (assessment_type === 'test') assessmentTable = 'tests';
    else if (assessment_type === 'q_assignment') assessmentTable = 'q_assignments';
    else throw new Error("Invalid assessment type");

    // 2. Create the main assessment (Quiz, Test, or Assignment)
    let assessmentResult;
    if (assessment_type === 'q_assignment') {
      assessmentResult = await db.query(
        `INSERT INTO ${assessmentTable} (title, description, classroom_id, due_date) VALUES ($1, $2, $3, $4) RETURNING id`,
        [title, description, classroom_id, due_date || null]
      );
    } else {
      assessmentResult = await db.query(
        `INSERT INTO ${assessmentTable} (title, description, classroom_id) VALUES ($1, $2, $3) RETURNING id`,
        [title, description, classroom_id]
      );
    }
    
    const newAssessmentId = assessmentResult.rows[0].id;

    // 3. Loop through and save all the questions
    for (const q of questions) {
      // ** THIS IS THE BUG FIX **
      // We now correctly find the answer text instead of just saving the index.
      const optionsObject = q.options || {}; // This is {'0': 'A', '1': 'B', ...}
      const correctIndex = q.correct; // This is '0', '1', ...
      const correctAnswerText = optionsObject[correctIndex]; // This finds the actual text

      if (!correctAnswerText) {
        // This stops the server from crashing if no correct answer is selected
        console.warn("Skipping question with no correct answer:", q.text);
        continue; 
      }
      
      await db.query(
        "INSERT INTO questions (assessment_id, assessment_type, question_text, options, correct_answer) VALUES ($1, $2, $3, $4, $5)",
        [newAssessmentId, assessment_type, q.text, JSON.stringify(optionsObject), correctAnswerText]
      );
    }
    
    req.flash('success', `${assessment_type} created successfully!`);
    res.redirect('/dashboard');

  } catch (err) {
    console.error("Error creating assessment:", err);
    req.flash('error', 'There was an error creating the assessment.');
    res.redirect('/teacher/create-assessment');
  }
});

// NEW: Leaderboard Route
app.get('/leaderboard', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    // Fetch top 20 users, ordered by XP in descending order
    const result = await db.query(
      "SELECT id, full_name, username, city, xp FROM users ORDER BY xp DESC LIMIT 20"
    );
    const topUsers = result.rows;

    res.render('leaderboard', { 
      user: req.session.user, 
      topUsers: topUsers 
    });
  } catch (err) {
    console.error("Error fetching leaderboard data:", err);
    res.redirect('/');
  }
});

  // --- Start Server ---
app.listen(port, () => {
    console.log(`🟢 Server running on http://localhost:${port}`);
  });
});