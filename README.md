# Career OS

A privacy-first job application assistant built to make applying faster without giving up control over what gets submitted.

Career OS combines a structured candidate profile, Chrome extension, AI-assisted resume and application tailoring, application tracking, and optional Gmail status detection into one workflow.

Built by [My Pham](https://mypham.space).

**Live app:** [apply.mypham.space](https://apply.mypham.space)  
**Portfolio:** [mypham.space](https://mypham.space)

> Career OS is maintained as a separate product from my personal portfolio, with its own codebase, database, authentication, and deployment pipeline.

---

## What it does

Career OS helps manage the full job application lifecycle:

**Discover → Analyze → Tailor → Review → Fill → Apply → Track → Follow up**

Instead of blindly generating or submitting answers, Career OS follows an **approve-before-use** model. AI can suggest content, but candidate facts remain grounded in information the user has explicitly provided.

### Job analysis

The Chrome extension reads supported job postings and extracts structured information such as:

- Role and company
- Location
- Job description
- Requirements
- Preferred qualifications
- Skills and technologies
- Application fields

The extracted posting can then be analyzed against the candidate profile.

### Candidate profile

Career OS maintains a reusable source of truth for:

- Education
- Work experience
- Projects
- Skills
- Leadership
- Contact information
- Work authorization
- Application preferences

This gives the AI structured evidence to work from instead of forcing users to repeatedly paste their resume.

### AI application assistance

Career OS can generate grounded suggestions for application fields using the candidate profile and job description.

The system is designed around one rule:

> **Never invent a candidate fact.**

Suggestions can be reviewed, edited, approved, or rejected before they are used.

### Resume tailoring

For tracked opportunities, Career OS can generate a resume-tailoring plan that identifies:

- Most relevant experiences
- Skills to emphasize
- Bullet points worth prioritizing
- Missing job-description keywords
- Potential alignment gaps

The goal is to improve positioning without fabricating experience.

### Safe autofill

Approved application answers can be inserted into supported application forms through the Chrome extension.

Autofill is separated from AI generation:

1. Analyze the page
2. Generate suggestions
3. Review suggestions
4. Approve specific answers
5. Fill approved answers

Filling a form never automatically marks an application as submitted.

### Application tracker

Applications can be tracked through stages such as:

- Saved
- In progress
- Applied
- Interview
- Offer
- Rejected
- Withdrawn

Each opportunity keeps its associated job data, application history, events, and next actions.

### Intelligent dashboard

The dashboard surfaces applications that need attention instead of acting as a static spreadsheet.

Examples include:

- Applications to finish
- Follow-ups due
- Recently submitted applications
- Upcoming actions
- Opportunities missing information
- Application activity

### Email status tracking

Users can optionally connect Gmail to detect application-related messages.

Career OS can classify signals such as:

- Application confirmation
- Recruiter outreach
- Interview invitation
- Assessment
- Rejection
- Offer
- General status update

Email integration is optional and separated from the core application workflow.

---

## Product principles

### User approval first

AI suggestions are never treated as automatically approved candidate information.

### Grounded generation

Generated application content must trace back to candidate-provided facts or the job posting.

### Explicit submission state

Career OS never assumes an application was submitted because fields were filled.

`APPLIED` is only entered through an explicit application action.

### Privacy by design

Sensitive candidate and email data remain scoped to the authenticated user through database authorization and row-level security.

### Deterministic where possible

Business-critical state transitions, lifecycle rules, and application tracking logic are handled deterministically rather than delegated entirely to an LLM.

---

## Architecture

Career OS is a monorepo containing the web application, Chrome extension, shared packages, AI services, and database infrastructure.

```text
job-application-tool/
├── apps/
│   ├── web/                  # Next.js application
│   └── extension/            # Chrome MV3 extension
│
├── packages/
│   ├── ai/                   # AI routing, prompting, and generation
│   ├── database/             # Shared database utilities/types
│   ├── shared/               # Shared schemas and domain logic
│   └── ...
│
├── supabase/
│   ├── migrations/           # PostgreSQL schema migrations
│   └── tests/                # Database / pgTAP tests
│
├── docs/
│   ├── ARCHITECTURE.md
│   └── IMPLEMENTATION_PLAN.md
│
└── README.md
```

### Web application

The web application handles:

- Authentication
- Candidate profile management
- Job/application tracking
- Resume tailoring
- Dashboard intelligence
- Application history
- Email integrations
- AI-assisted actions

### Chrome extension

The extension handles the browser-side workflow:

- Job posting extraction
- Application page inspection
- Field detection
- Suggestion review
- Approved autofill
- Application save/update actions

### Backend

Supabase provides:

- PostgreSQL
- Authentication
- Row-level security
- Database functions
- Application lifecycle persistence
- Event history
- Email integration storage

---

## Tech stack

### Frontend

- Next.js 14
- React
- TypeScript
- Tailwind CSS

### Browser extension

- Chrome Manifest V3
- TypeScript
- React

### Backend

- Supabase
- PostgreSQL
- Row-Level Security
- SQL migrations
- pgTAP

### AI

- Anthropic Claude
- OpenAI models
- Multi-provider model routing
- Structured generation
- Evidence-grounded prompting

### Infrastructure

- Vercel
- Supabase
- GitHub

---

## Application lifecycle

Career OS deliberately separates application preparation from submission.

```text
SAVED
  ↓
IN_PROGRESS
  ↓
APPLIED
  ↓
INTERVIEW
  ↓
OFFER
```

Applications can also transition to terminal states such as:

```text
REJECTED
WITHDRAWN
```

`APPLIED` is never inferred from autofill activity.

The canonical submission flow explicitly records the application event and establishes the follow-up timeline used by the dashboard.

---

## AI safety model

Career OS treats the candidate profile as the primary factual source.

Before generating an answer, the system considers:

```text
Candidate Profile
       +
Job Posting
       +
Application Question
       ↓
Evidence Selection
       ↓
AI Suggestion
       ↓
User Review
       ↓
Approved Answer
```

This architecture reduces hallucinated experience and gives users visibility into what is actually being submitted.

---

## Database

The database is managed through versioned Supabase migrations.

Major schema areas include:

- Candidate profiles
- Experiences
- Projects
- Skills
- Jobs
- Applications
- Application events
- Generated answers
- AI usage
- Resume-tailoring data
- Email connections
- Email signals
- Next actions

Database authorization is enforced with PostgreSQL row-level security so records remain scoped to their owner.

---

## Current status

Career OS has progressed through the core application workflow and opportunity-intelligence phases.

Implemented areas include:

- Authentication and user isolation
- Candidate profile
- Manual application tracker
- Chrome extension shell
- Job-page extraction
- AI-generated application suggestions
- Review and approval workflow
- Safe autofill engine
- Application persistence
- Explicit mark-as-applied flow
- Application event history
- Opportunity intelligence
- Resume-tailoring assistance
- Intelligent dashboard
- Next-action engine
- AI-assisted actions
- Gmail integration infrastructure
- Product hardening and UX polish

Development status and implementation details are tracked in:

[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)

Architecture decisions are documented in:

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Running locally

### Requirements

- Node.js
- npm
- Supabase project
- Chrome or Chromium-based browser

Clone the repository:

```bash
git clone https://github.com/phammy237/job-application-tool.git
cd job-application-tool
```

Install dependencies:

```bash
npm install
```

Configure the required environment variables using the repository's environment examples and development configuration.

Run the web application:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

The Chrome extension can be loaded as an unpacked extension after building the extension workspace.

---

## Development

Before committing changes, run the repository's validation commands for the areas you modified.

Typical checks include:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Database changes should be introduced through new migrations rather than modifying migrations that have already been applied.

---

## Why I built it

Applying to internships and jobs often means repeating the same information across dozens of systems while manually tracking applications in spreadsheets, searching email for updates, and rewriting essentially the same experience for every role.

Career OS started as a way to combine those workflows into one system.

The project also explores a broader product question:

> How much of the job application process can be automated while still keeping the applicant fully in control?

Career OS intentionally stops short of autonomous application submission. The product focuses on removing repetitive work while preserving user review, factual accuracy, and explicit consent.

---

## Author

**My Pham**

Data Science @ University of Florida

[mypham.space](https://mypham.space) · [LinkedIn](https://linkedin.com/in/mypham237) · [GitHub](https://github.com/phammy237)

---

*Career OS is an independent personal project and is not affiliated with the companies or application platforms it may interact with.*