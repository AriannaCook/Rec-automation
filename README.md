# Rec Automation

A browser-based recruiting automation app powered by Claude. Supports multiple concurrent role searches, each with its own JD and persisted outputs across all 7 stages.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your API key

```bash
cp .env.example .env
```

Edit `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

### 3. Start the server

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

For development with auto-restart:

```bash
npm run dev
```

---

## The 7 Stages

| Stage | Name | What it does |
|-------|------|-------------|
| 1 | **Job Intake** | Paste or upload a JD (PDF/Word/text). Claude auto-populates a confirmation email template. The JD is stored for all subsequent stages. |
| 2 | **Boolean Generator** | One click generates 5 LinkedIn Recruiter Boolean strings: 2 title searches + 3 keyword searches. Refinement box rewrites all 5 at once. |
| 3 | **Candidate Screener** | Paste raw LinkedIn results (up to 25 per batch). Claude rates each YES / MAYBE / NO with a reason. Results accumulate across batches with counters. |
| 4 | **Outreach Generator** | One click generates a cold outreach message following strict format rules (no company name, no em dashes, specific closing line). |
| 5 | **Clarification Message** | For MAYBE candidates. Paste their profile and Claude writes a pre-call message that identifies relevance and names the gap precisely. |
| 6 | **Candidate Writeup** | Fill in candidate details + call notes. Claude generates a 6-bullet structured writeup mapping their background to the role. |
| 7 | **Interview Prep Email** | Long-form prep email covering: company overview, interviewer background, likely questions, how to pitch experience, candidate questions, and core logistics. JD auto-populates from Stage 1. |

Every stage has a **Refinement box** at the bottom. Describe what's off and hit Refine (or `Cmd+Enter`) to rewrite in place.

---

## Multi-role support

Use the **+** button in the sidebar to create multiple concurrent searches. Each role stores its own JD and all stage outputs. Click a role name to rename it. Data persists in the browser via localStorage.

---

## File uploads

Stage 1 supports uploading PDF and Word (`.docx` / `.doc`) files. Text is extracted server-side and populated into the JD field.

---

## Requirements

- Node.js 18+
- An Anthropic API key with access to `claude-sonnet-4-20250514`
