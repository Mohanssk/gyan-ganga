# Gyaan Ganga

A gamified LMS platform for students and teachers, built with Express, EJS, and PostgreSQL.

Students can explore course topics, watch mission videos, submit assessments, and track progress.
Teachers can create classrooms, upload content, assign quizzes/tests/assignments, and review submissions.

## Features

### Student
- Sign up / login with role-based access.
- Join classrooms using class codes.
- Explore course categories and missions.
- Watch lesson videos and track mission progress.
- Take quizzes, tests, and assignments.
- View leaderboard and profile.

### Teacher
- Role-based teacher dashboard.
- Create and manage classrooms.
- Upload mission videos.
- Create, edit, and delete assessments.
- View assessment results and submission details.
- Browse enrolled students.

## Tech Stack
- Node.js (ES modules)
- Express.js
- EJS templates
- PostgreSQL (`pg`)
- Session auth (`express-session`)
- File upload (`multer`)
- Tailwind (CDN) + custom styling

## Project Structure

```text
.
├── migrations/
│   └── 001_schema_core.sql
├── public/
│   ├── images/
│   ├── videos/
│   │   ├── sample_video_eng.mp4
│   │   └── uploads/
│   └── style.css
├── scripts/
│   └── migrate.js
├── views/
│   ├── partials/
│   └── *.ejs
├── server.js
├── vercel.json
└── query.sql
```

## Prerequisites
- Node.js 20.x
- PostgreSQL (local or hosted)
- npm

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create environment file

```bash
cp .env.example .env
```

3. Update `.env` values

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
SESSION_SECRET=change-me-to-a-long-random-secret
NODE_ENV=development
PORT=3000
```

4. Run migrations

```bash
npm run migrate
```

5. (Optional) Seed sample topics/missions/videos
- Use insert sections from `query.sql` if you want demo data.
- The schema itself is already handled by migrations.

6. Start the app

```bash
npm run dev
```

or

```bash
npm start
```

7. Open in browser
- http://localhost:3000

## Available Scripts

- `npm run dev` - start server in local mode
- `npm start` - start server
- `npm run migrate` - apply pending SQL migrations
- `npm run migrate:status` - view migration status

## Technical Core Routes

### Public / Auth
- `GET /`
- `GET /login`
- `POST /login`
- `GET /signup`
- `POST /signup`
- `GET /logout`

### Common
- `GET /dashboard`
- `GET /profile`
- `POST /profile`
- `GET /leaderboard`

### Student
- `POST /student/join-class`
- `GET /courses/:category`
- `GET /search`
- `GET /mission/:id`
- `GET /quizzes`
- `GET /tests`
- `GET /assignments`
- `GET /assessments/:type/:id`
- `POST /assessments/:type/:id/submit`

### Teacher
- `GET /teacher/my-classes`
- `POST /teacher/my-classes`
- `GET /teacher/my-students`
- `GET /teacher/upload-video`
- `POST /teacher/upload-video`
- `GET /teacher/create-assessment`
- `POST /teacher/create-assessment`
- `GET /teacher/assessments/:type/:id/edit`
- `POST /teacher/assessments/:type/:id/edit`
- `POST /teacher/assessments/:type/:id/delete`
- `GET /teacher/assessment-results`
- `GET /teacher/assessment-results/:type/:id`
- `GET /teacher/assessment-results/:type/:assessmentId/submissions/:submissionId`

### Route Purpose Table

| Endpoint | Purpose |
|---|---|
| GET / | Landing page and role-based redirect to dashboard |
| GET /login | Show login form |
| POST /login | Authenticate user and create session |
| GET /signup | Show registration form |
| POST /signup | Register a new student or teacher |
| GET /logout | Destroy user session |
| GET /dashboard | Main dashboard (student or teacher) |
| GET /profile | View profile |
| POST /profile | Update profile details |
| GET /leaderboard | Show top users by XP |
| POST /student/join-class | Enroll student into a classroom by class code |
| GET /courses/:category | List topics by category |
| GET /search | Search topics and missions |
| GET /mission/:id | Open mission learning page |
| GET /quizzes | List student quizzes |
| GET /tests | List student tests |
| GET /assignments | List student assignments |
| GET /assessments/:type/:id | Open assessment attempt page |
| POST /assessments/:type/:id/submit | Submit assessment answers |
| GET /teacher/my-classes | View teacher classrooms |
| POST /teacher/my-classes | Create a classroom |
| GET /teacher/my-students | View/search enrolled students |
| GET /teacher/upload-video | Open video upload page |
| POST /teacher/upload-video | Upload and save mission video metadata |
| GET /teacher/create-assessment | Open assessment creation page |
| POST /teacher/create-assessment | Create assessment and questions |
| GET /teacher/assessments/:type/:id/edit | Open assessment edit page |
| POST /teacher/assessments/:type/:id/edit | Save assessment edits |
| POST /teacher/assessments/:type/:id/delete | Delete an assessment |
| GET /teacher/assessment-results | List all teacher assessments with stats |
| GET /teacher/assessment-results/:type/:id | Show submissions for one assessment |
| GET /teacher/assessment-results/:type/:assessmentId/submissions/:submissionId | Show detailed student answers |

## How to Use This Website

This guide explains exactly how students and teachers should use the platform day to day.

### 1) First time setup for any user
1. Open the website home page.
2. Click Sign Up.
3. Select your role carefully:
	Student: for learning, joining classes, taking assessments.
	Teacher: for creating classes, content, and assessments.
4. Log in with your username and password.
5. After login, you will land on your role-based dashboard.

### 2) Student guide (learning flow)
1. Join your class:
	Go to dashboard and enter the classroom code shared by your teacher.
2. Explore learning content:
	Open course categories and select a topic.
3. Complete missions:
	Watch video lessons, use controls (speed, volume, fullscreen), and continue mission steps.
4. Take assessments:
	Open Assignments, Quizzes, or Tests and submit answers before due dates.
5. Track progress:
	Check XP, coins, badges, and leaderboard rank from dashboard/leaderboard.
6. Keep profile updated:
	Use Profile to edit personal details.

### 3) Teacher guide (teaching flow)
1. Create a classroom:
	Open My Classrooms and add class name, subject, and grade.
2. Share class code:
	Give the generated code to students so they can join.
3. Add learning content:
	Use Upload Video to add mission videos.
4. Create assessments:
	Use Create Assessment to add assignments, quizzes, or tests with questions.
5. Monitor performance:
	Open Assessment Results to view submission stats and student-wise details.
6. Review student answers:
	Open each submission to see question-level answers and correctness.
7. Manage your learners:
	Use My Students to view enrolled students and search quickly.

### 4) Assessment status meanings
- Pending: student has not submitted yet.
- Completed: submission is recorded.
- Overdue: due date passed before submission.

### 5) Practical tips
- Teachers should create classrooms first, then upload content and assessments.
- Students should join a class before expecting content to appear.
- If a page looks empty, verify class enrollment and available data.

## Troubleshooting

### `npm start` exits immediately
- Check `.env` exists and `DATABASE_URL` is valid.
- Ensure PostgreSQL is running and reachable.

### Tables missing / SQL errors
- Run `npm run migrate`.
- Check status with `npm run migrate:status`.

### No data visible in UI
- Seed data from `query.sql` or create data through teacher flows.

## License

ISC
