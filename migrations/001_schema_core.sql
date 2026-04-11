DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('student', 'teacher');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS school_name VARCHAR(150),
ADD COLUMN IF NOT EXISTS grade VARCHAR(10),
ADD COLUMN IF NOT EXISTS city VARCHAR(100),
ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS gyaan_coins INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS badges_earned INT DEFAULT 0;

UPDATE users
SET
    gyaan_coins = FLOOR(COALESCE(xp, 0) / 5.0)::INT,
    badges_earned = CASE
        WHEN COALESCE(xp, 0) >= 2200 THEN 6
        WHEN COALESCE(xp, 0) >= 1500 THEN 5
        WHEN COALESCE(xp, 0) >= 1000 THEN 4
        WHEN COALESCE(xp, 0) >= 600 THEN 3
        WHEN COALESCE(xp, 0) >= 300 THEN 2
        WHEN COALESCE(xp, 0) >= 100 THEN 1
        ELSE 0
    END;

CREATE TABLE IF NOT EXISTS topics (
    id SERIAL PRIMARY KEY,
    topic_name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    grade_level INT NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
    id SERIAL PRIMARY KEY,
    topic_id INT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    mission_title VARCHAR(200) NOT NULL,
    mission_description TEXT,
    mission_order INT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    mission_id INT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    video_title VARCHAR(200) NOT NULL,
    video_description TEXT,
    video_url VARCHAR(255) NOT NULL,
    video_order INT NOT NULL,
    language VARCHAR(20) NOT NULL DEFAULT 'english',
    quality VARCHAR(20) NOT NULL DEFAULT '720p'
);

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_videos_mission_order ON videos (mission_id, video_order);

CREATE TABLE IF NOT EXISTS classrooms (
    id SERIAL PRIMARY KEY,
    class_name VARCHAR(120) NOT NULL,
    class_code VARCHAR(12) UNIQUE,
    subject VARCHAR(100),
    grade_level INT,
    teacher_id INT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

UPDATE classrooms
SET class_code = UPPER(SUBSTRING(MD5(id::text) FROM 1 FOR 6))
WHERE class_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_classrooms_class_code_unique ON classrooms (class_code);
CREATE INDEX IF NOT EXISTS idx_classrooms_teacher_id ON classrooms (teacher_id);

CREATE TABLE IF NOT EXISTS classroom_enrollments (
    id SERIAL PRIMARY KEY,
    classroom_id INT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_enrollments_classroom_id ON classroom_enrollments (classroom_id);
CREATE INDEX IF NOT EXISTS idx_classroom_enrollments_student_id ON classroom_enrollments (student_id);

CREATE TABLE IF NOT EXISTS quizzes (
    id SERIAL PRIMARY KEY,
    classroom_id INT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tests (
    id SERIAL PRIMARY KEY,
    classroom_id INT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS q_assignments (
    id SERIAL PRIMARY KEY,
    classroom_id INT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    assessment_id INT NOT NULL,
    assessment_type VARCHAR(20) NOT NULL CHECK (assessment_type IN ('quiz', 'test', 'q_assignment')),
    question_text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_answer TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assessment_submissions (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assessment_id INT NOT NULL,
    assessment_type VARCHAR(20) NOT NULL CHECK (assessment_type IN ('quiz', 'test', 'q_assignment')),
    answers JSONB,
    score INT NOT NULL DEFAULT 0,
    total_questions INT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, assessment_type, assessment_id)
);

CREATE INDEX IF NOT EXISTS idx_quizzes_classroom ON quizzes (classroom_id);
CREATE INDEX IF NOT EXISTS idx_tests_classroom ON tests (classroom_id);
CREATE INDEX IF NOT EXISTS idx_q_assignments_classroom ON q_assignments (classroom_id);
CREATE INDEX IF NOT EXISTS idx_questions_assessment ON questions (assessment_type, assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_submissions_lookup ON assessment_submissions (student_id, assessment_type, assessment_id);

CREATE TABLE IF NOT EXISTS student_mission_progress (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_id INT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'visited',
    visit_count INT NOT NULL DEFAULT 1,
    last_watched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_student_mission_progress_student ON student_mission_progress (student_id);
CREATE INDEX IF NOT EXISTS idx_student_mission_progress_mission ON student_mission_progress (mission_id);
