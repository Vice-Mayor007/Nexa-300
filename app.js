const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const fs = require("fs");
const marked = require("marked");
const app = express();
const dotenv = require("dotenv");
dotenv.config();

const port = process.env.PORT || 6000;
const MONGO_URL = process.env.MONGO_URL;
const APIKEY = process.env.API_KEY; // Ensure this is set in your .env file

// Middleware
app.use(cors());
app.use(express.json()); // For parsing JSON body

app.use(express.static(path.join(__dirname, "../frontend/views")));
app.use(express.urlencoded({ extended: true })); // For parsing URL-encoded body

const homePage = "frontend/views/index.html";
const loginPage = "frontend/views/login.html";
const signupPage = "frontend/views/signup.html";
const dashboardPage = "frontend/views/dashboard.html";

mongoose
  .connect(MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1); // Exit the process if MongoDB connection fails
  });
app.use(
  session({
    secret: process.env.SESSION_SECRET || "6hrh", // fallback to "6hrh" if not defined
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 100000000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

// MongoDB User Schema
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  role: {
    type: String,
    enum: ["mentor", "student"],
    default: "student",
  },
  courses: [String],
  contact: [String],
});

const User = mongoose.model("User", userSchema);

// Auth Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.authenticated) {
    return next();
  }
  res.redirect("/login.html");
};

// Middleware to initialize conversation history for each user
app.use((req, res, next) => {
  if (!conversationHistory[req.sessionID]) {
    conversationHistory[req.sessionID] = [];
  }
  next();
});
// Routes
app.get("/", (req, res) => {
  res.sendFile(homePage);
});

const conversationHistory = {};
app.post("/register", async (req, res) => {
  const { username, email, password, role, courses, contact } = req.body;
  console.log(courses)
  // Check if all required fields are provided
  if (!username || !email || !password || !role || !courses || !contact) {
    return res.status(400).json({
      message: "Username, email, password, role, and courses are required",
    });
  }

  // Check if the email already exists
  const userByEmail = await User.findOne({ email });
  if (userByEmail) {
    return res.status(400).json({ message: "Email is already registered" });
  }

  // Check if the username already exists
  const userByUsername = await User.findOne({ username });
  if (userByUsername) {
    return res.status(400).json({ message: "Username is already taken" });
  }

  // If username and email are unique, continue with registration
  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = new User({
    username,
    email,
    password: hashedPassword,
    role,
    courses: courses,
    contact: contact.split(","),
  });

  await newUser.save();
  res.status(201).json({ message: "User registered successfully" });
});
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Username and password required." });
  }

  const user = await User.findOne({ username });
  if (!user) {
    return res.status(401).json({ success: false, message: "User not found." });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res
      .status(401)
      .json({ success: false, message: "Incorrect password." });
  }

  req.session.authenticated = true;
  req.session.user = user;
  res
    .status(200)
    .json({ success: true, message: "Login successful", role: user.role });
});

app.get("/dashboard", isAuthenticated, (req, res) => {
  const userRole = req.session.user.role;

  userRole === "mentor"
    ? res.sendFile(
        path.join(__dirname, "../frontend/views/mentordashboard.html")
      )
    : res.sendFile(
        path.join(__dirname, "../frontend/views/studentdashboard.html")
      );
});
app.get("/ai-chat", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/views/ai-chat.html"));
});

app.post("/ai/chat", isAuthenticated, async (req, res) => {
  const userMessage = req.body.message;
  const userId = req.sessionID;

  // Append user's message to conversation history
  conversationHistory[userId].push({ role: "user", content: userMessage });

  try {
    const response = await fetch(
      "https://api.ai21.com/studio/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${APIKEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "jamba-large-1.6",
          messages: conversationHistory[userId],
          n: 1,
          max_tokens: 2048,
          temperature: 0.4,
          top_p: 1,
          stop: [],
          response_format: { type: "text" },
        }),
      }
    );

    const data = await response.json();
    let rawReply = data?.choices?.[0]?.message?.content;

    if (!rawReply) {
      rawReply = "Sorry, I didn't get a response from the AI.";
    }

    let formattedReply;
    try {
      formattedReply = marked.parse(rawReply); // Convert Markdown to HTML
    } catch (err) {
      console.error("Markdown formatting failed:", err);
      formattedReply = `<p>${rawReply}</p>`;
    }

    res.json({
      success: true,
      response: formattedReply,
    });
  } catch (error) {
    console.error("Error contacting AI21:", error);
    res.status(500).json({
      success: false,
      response: "Failed to contact AI.",
    });
  }
});

app.get("/user/profile", isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    if (!user) throw new Error("User data not found in session");
    res
      .status(200)
      .json({ success: true, name: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

app.get("/my-mentors",isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/views/mentor-matching.html"));
});

// POST /findmentors
app.post("/findmentors", isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || !user.username || user.role !== "student") {
      return res.status(401).json({
        success: false,
        message: "Authentication required for students",
      });
    }

    const studentCourses = user.courses;

    if (
      !studentCourses ||
      !Array.isArray(studentCourses) ||
      studentCourses.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Your selected courses are empty. Please update your profile.",
      });
    }

    const mentors = await User.find({
      role: "mentor",
      courses: { $in: studentCourses }, // Find mentors who teach at least one of the student's courses
    });

    if (mentors.length === 0) {
      return res.json({
        success: false,
        message: "No mentors found for your selected courses.",
      });
    }

    res.json({
      success: true,
      message: "Mentors found matching your interests.",
      mentors,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error while finding mentors.",
    });
  }
});

// POST /findstudents
app.post("/findstudents", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || !user.username) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { courses } = req.body;
    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Courses array is required and must not be empty",
      });
    }

    const students = await User.find({
      role: "student",
      courses: { $in: courses },
    });

    if (students.length === 0) {
      return res.json({
        success: false,
        message: "No students found for the provided courses",
      });
    }

    res.json({
      success: true,
      message: "Students found matching the courses",
      students,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error while finding students",
    });
  }
});
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Logout failed." });

    res.redirect("/login.html");
  });
});

// Get user profile
app.get("/api/user/profile", isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    // Get fresh user data from database
    const userData = await User.findOne({ username: user.username });
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user: {
        username: userData.username,
        email: userData.email,
        role: userData.role,
        courses: userData.courses,
        contact: userData.contact,
      },
    });
  } catch (error) {
    console.error("Error getting user profile:", error);
    res.status(500).json({
      success: false,
      message: "Server error while getting user profile",
    });
  }
});
app.post("/search-mentors", isAuthenticated, async (req, res) => {
  try {
    const { searchQuery } = req.body;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const query = { role: "mentor" };
    const searchRegex = { $regex: new RegExp(searchQuery, "i") };
    let mentors;

    // Try searching by username first
    mentors = await User.find({ ...query, username: searchRegex }).select(
      "-password"
    );

    // If no mentors found by username, try searching by course
    if (mentors.length === 0) {
      const courseSearchMentors = await User.find({
        ...query,
        courses: searchRegex,
      }).select("-password");

      mentors = courseSearchMentors;
    }

    if (mentors.length === 0) {
      return res.json({
        success: false,
        message: "No mentors found matching your search",
      });
    }

    res.json({
      success: true,
      mentors: mentors,
    });
  } catch (error) {
    console.error("Error searching mentors:", error);
    res.status(500).json({
      success: false,
      message: "Error searching mentors",
    });
  }
});
app.listen(port, () =>
  console.log(`Server running on http://localhost:${port}`)
);
