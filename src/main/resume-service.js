// src/main/resume-service.js
const pdfParse = require('pdf-parse');
const path     = require('path');
const fs       = require('fs');

const SKILL_KEYWORDS = [
  // Languages
  'JavaScript','TypeScript','Python','Java','C++','C#','Go','Rust','Ruby','PHP','Swift','Kotlin','Scala','R',
  // Frontend
  'React','Vue','Angular','Next.js','Nuxt','Svelte','HTML','CSS','Tailwind','Redux','MobX','GraphQL','Webpack','Vite',
  // Backend
  'Node.js','Express','NestJS','Django','Flask','FastAPI','Spring Boot','Laravel','Rails','ASP.NET',
  // Databases
  'PostgreSQL','MySQL','MongoDB','Redis','SQLite','DynamoDB','Cassandra','Elasticsearch','Supabase','Firebase',
  // Cloud & DevOps
  'AWS','Azure','GCP','Docker','Kubernetes','Terraform','CI/CD','Jenkins','GitHub Actions','Ansible','Linux',
  // Tools & Practices
  'Git','REST API','Microservices','GraphQL','Agile','Scrum','TDD','System Design','gRPC',
  // AI/ML
  'TensorFlow','PyTorch','scikit-learn','Pandas','NumPy','Machine Learning','Deep Learning','LLM','NLP','OpenAI',
];

async function parseResume(filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  let text = '';

  if (ext === '.pdf') {
    const buf  = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    text = data.text;
  } else if (ext === '.txt') {
    text = fs.readFileSync(filePath, 'utf-8');
  } else {
    throw new Error('Unsupported file format. Use PDF or TXT.');
  }

  const skills = SKILL_KEYWORDS.filter(s =>
    new RegExp(`\\b${s.replace('+', '\\+')}\\b`, 'i').test(text)
  );

  return {
    text:   text.slice(0, 3000),   // limit tokens for LLM context
    skills: [...new Set(skills)],
    fileName: path.basename(filePath),
  };
}

module.exports = { parseResume };