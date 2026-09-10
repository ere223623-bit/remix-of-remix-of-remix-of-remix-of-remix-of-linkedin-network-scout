# Remix of Remix of Remix of Remix of Remix of LinkedIn Network Scout

I want you to implement a production-ready LinkedIn Search module in this existing project using the open-source Agent Reach repository as the primary integration layer:

Repository:
https://github.com/Panniantong/Agent-Reach

IMPORTANT:
Do not build a new LinkedIn scraper from scratch if Agent Reach already provides the required functionality. First inspect Agent Reach's current LinkedIn implementation, installation documentation, channel architecture, supported backends, authentication requirements, and limitations. Then integrate it correctly into this project.

1. FIRST — AUDIT THE CURRENT PROJECT

Before changing any code:

Inspect the entire existing repository.

Detect the current frontend architecture.

Detect whether a backend already exists.

Detect React/Vite/Next.js configuration.

Detect Firebase/Supabase/database usage.

Detect existing API/server/Edge Function architecture.

Detect authentication and user roles.

Detect environment variable management.

Detect whether Python services can run in the current deployment environment.

Do not break or replace existing functionality.

Produce a short implementation plan before making architectural changes.

2. ARCHITECTURE

Agent Reach MUST NOT run directly inside the React browser.

Use this architecture:

React / Lovable UI
↓
Application Backend API
↓
LinkedIn Search Service
↓
Agent Reach
↓
Available LinkedIn backend
↓
Normalized Results
↓
Application Database
↓
React Results UI

If the existing backend cannot run Agent Reach/Python/CLI dependencies, create a separate lightweight Python FastAPI service.

The frontend must communicate with it only through secure HTTP API endpoints.

Never expose LinkedIn cookies, credentials, Agent Reach configuration, or internal service credentials to the browser.

3. AGENT REACH INSTALLATION

Use the official Agent Reach repository.

Prefer an isolated environment.

Install and configure Agent Reach according to its current documentation.

Run:

agent-reach doctor

Verify LinkedIn availability.

Do NOT assume a LinkedIn capability exists merely because it appears in documentation.

The implementation must detect actual runtime capability.

Create an internal health endpoint:

GET /api/integrations/linkedin/status

Return normalized information such as:

{
"available": true,
"backend": "...",
"authenticated": true,
"capabilities": [
"profile_search",
"company_search",
"job_search"
]
}

The actual capabilities must come from the installed implementation and must not be fabricated.

4. LINKEDIN SEARCH PAGE

Create a new page:

/linkedin-search

The interface should be clean, professional and responsive.

Create a main search bar:

[ Search LinkedIn __________________ ] [ Search ]

Add Advanced Search.

Filters should include when technically supported:

Keywords

Person name

Job title

Company

Industry

Location

Country

Current company

Previous company

Skills

Seniority

Profile URL

Results limit

Do not send unsupported filters to Agent Reach.

Gracefully disable filters that the installed LinkedIn backend cannot support.

5. SEARCH MODES

Provide tabs:

People
Companies
Jobs

Only activate modes actually supported by the available backend.

If one mode is unavailable, show:

"Not supported by the currently configured LinkedIn backend."

Do not simulate results.

6. PEOPLE RESULTS

Normalize available LinkedIn people results into:

{
"name": "",
"headline": "",
"job_title": "",
"company": "",
"location": "",
"profile_url": "",
"source": "linkedin",
"retrieved_at": ""
}

Optional fields may include:

{
"industry": "",
"education": [],
"skills": [],
"about": "",
"experience": []
}

Never invent unavailable information.

NULL/unknown values should remain null.

7. RESULTS UI

Display results as professional cards.

Each person card should show:

Profile photo — only when legitimately returned by the source
Name
Headline
Current Position
Company
Location

Actions:

View Details
Open LinkedIn
Save
Copy Profile URL

Also provide:

List View
Table View

Table columns:

Name
Title
Company
Location
LinkedIn
Source
Retrieved At

Add pagination or incremental loading for larger result sets.

8. PROFILE DETAILS

Clicking a person should open:

/linkedin-search/profile/:id

Display all information actually retrieved from the backend.

Sections:

Overview
Current Position
Experience
Education
Skills
About
Source Information

Never generate fake LinkedIn profile fields with AI.

Clearly distinguish:

SOURCE DATA

from:

AI ANALYSIS

9. COMPANY SEARCH

When supported, allow searching companies.

Normalized structure:

{
"name": "",
"industry": "",
"location": "",
"description": "",
"linkedin_url": "",
"website": "",
"source": "linkedin"
}

Do not fabricate employee counts, revenue, contacts, or other fields.

10. JOB SEARCH

When supported, create job results containing available fields such as:

Job Title
Company
Location
Description
LinkedIn URL
Published Date
Retrieved Date

Filters may include:

Keywords
Location
Company
Job Title

Again: only expose filters supported by the real backend.

11. SEARCH API

Create:

POST /api/linkedin/search

Example request:

{
"type": "people",
"query": "software engineer",
"filters": {
"location": "Saudi Arabia",
"company": "Aramco"
},
"limit": 20
}

Return:

{
"success": true,
"query": {},
"results": [],
"count": 0,
"backend": "",
"retrieved_at": ""
}

Create a stable adapter so the frontend never depends directly on Agent Reach's raw CLI output.

12. BACKEND ADAPTER

Create:

LinkedInProvider

with an interface similar to:

searchPeople()
searchCompanies()
searchJobs()
getProfile()
healthCheck()
getCapabilities()

Agent Reach should be one implementation:

AgentReachLinkedInProvider

This abstraction is important because Agent Reach's upstream LinkedIn backend may change later.

The application must be able to replace the backend without rewriting the frontend.

13. SEARCH HISTORY

Store:

Query
Filters
Search type
Date/time
Result count
Backend
Status

Create:

/linkedin-search/history

Allow:

View
Re-run
Delete

Do NOT store LinkedIn authentication cookies inside normal application tables.

14. SAVED PROFILES

Allow users to save interesting results.

Create a Saved Profiles section.

Store only information actually retrieved.

Add:

Notes
Tags
Favorite
Date saved

Allow filtering saved profiles by:

Company
Location
Job title
Tags

15. EXPORT

Allow exporting search results to:

CSV
JSON

Fields must correspond only to actual retrieved data.

16. SECURITY

This is critical.

Never expose:

LinkedIn cookies
Session tokens
Agent Reach credentials
Browser session information
Backend secrets

to the React frontend.

Secrets must stay server-side.

Use environment variables or an appropriate secure secret store.

Do not commit secrets to Git.

Do not log authentication cookies.

Sanitize API errors before returning them to the frontend.

Implement:

Rate limiting
Input validation
Timeouts
Error handling
Request size limits

17. ACCOUNT SAFETY

Do not automate LinkedIn login.

Do not request LinkedIn username/password through the application.

Use only authentication mechanisms explicitly supported by the currently installed Agent Reach LinkedIn integration.

Do not implement CAPTCHA bypassing or anti-bot circumvention.

If authentication expires, return:

LINKEDIN_AUTH_REQUIRED

and provide a safe configuration message to the administrator.

18. RESILIENCE

Agent Reach relies on upstream tools that may change.

Therefore implement:

Timeout handling
Backend availability detection
Graceful errors
Capability detection
Health checks

Possible states:

READY
AUTH_REQUIRED
BACKEND_UNAVAILABLE
RATE_LIMITED
TIMEOUT
CONFIGURATION_ERROR

Never convert an upstream failure into fake empty results.

19. ADMIN DIAGNOSTICS

Create:

/admin/integrations/linkedin

Show:

Agent Reach installed
Agent Reach version
LinkedIn backend
Authentication status
Supported capabilities
Last successful search
Last error
Average response time

Add:

Run Health Check

which executes the appropriate Agent Reach diagnostic safely.

20. TESTING

Add tests for:

LinkedIn API
Input validation
Normalization
Provider adapter
Empty results
Authentication failure
Timeout
Backend unavailable
Rate limiting
Malformed Agent Reach response

Mock external LinkedIn calls during automated tests.

Do not require a real LinkedIn account for the normal test suite.

21. FINAL VERIFICATION

After implementation:

Run the complete project tests.

Run Agent Reach diagnostics.

Verify the React frontend.

Verify backend connectivity.

Verify no credentials are exposed in browser requests.

Verify no secrets exist in repository files.

Verify search results come from the real backend and are not mock data.

Verify unsupported LinkedIn capabilities are not falsely advertised.

Finally produce:

LINKEDIN-AGENT-REACH-IMPLEMENTATION.md

containing:

Architecture
Files changed
Installation steps
Environment variables
Agent Reach configuration
LinkedIn backend detected
Supported capabilities
API endpoints
Security controls
Tests
Known limitations
Deployment requirements

Do not mark the module COMPLETE unless an actual LinkedIn search has been executed successfully through the configured Agent Reach backend and real results were returned.

If real LinkedIn verification cannot be performed, mark it:

IMPLEMENTED — REAL LINKEDIN VERIFICATION PENDING

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/61386f58-9d95-4754-8a1a-9c32318c54ba).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
