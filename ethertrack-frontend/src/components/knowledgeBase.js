// ─────────────────────────────────────────────────────────────────────────────
// knowledgeBase.js — EtherTrack Support Knowledge Base
// ─────────────────────────────────────────────────────────────────────────────
//
// HOW TO ADD A NEW MODULE:
//   1. Add a new object to KNOWLEDGE_BASE array.
//   2. Each subtopic supports:
//      - question    : what the user is asking
//      - keywords    : words/phrases to match (more = better search)
//      - answer      : short conversational reply (1–2 sentences)
//      - steps       : optional array of step-by-step instructions
//      - followUps   : phrases a user might ask as a follow-up
//      - escalate    : true → always suggest ticket after answer
//      - tags        : extra labels for intent detection ("error","billing","account")
//
// INTENT TAGS (used for auto-escalation & smart replies):
//   "error"    → user is facing a problem
//   "billing"  → payment / plan related
//   "account"  → login / profile / access
//   "blocked"  → something is stopping the user
//   "kyc"      → identity verification
//   "wallet"   → blockchain / web3
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWLEDGE_BASE = [

  // ── MODULE: Getting Started ────────────────────────────────────────────────
  {
    id: "getting-started",
    icon: "🚀",
    label: "Getting Started",
    subtopics: [
      {
        id: "what-is-ethertrack",
        question: "What is EtherTrack?",
        keywords: ["what is", "ethertrack", "about", "platform", "overview", "intro", "explain"],
        answer: "EtherTrack is a blockchain-powered platform for carbon credit trading and emissions tracking. Organizations use it to log GHG emissions, buy/sell/retire carbon credits, achieve regulatory compliance, and generate on-chain verified certificates.",
        followUps: ["how do i get started", "what can i do on ethertrack", "who is ethertrack for"],
        tags: [],
      },
      {
        id: "how-to-signup",
        question: "How do I sign up?",
        keywords: ["sign up", "signup", "register", "create account", "new user", "get started", "join"],
        answer: "Signing up takes less than 2 minutes! Here's how:",
        steps: [
          "Go to the EtherTrack homepage and click 'Sign Up'",
          "Choose your method — Email/Password, Google, or Facebook",
          "Verify your email address if signing up with email",
          "Complete KYC verification (required for trading features)",
          "Join or create your organization",
          "Select a plan — you can start with the Free tier",
        ],
        followUps: ["how do i verify email", "what is kyc", "how do i join an org"],
        tags: ["account"],
      },
      {
        id: "login-issues",
        question: "I can't log in to my account",
        keywords: ["cant login", "can't login", "login failed", "login error", "wrong password", "forgot password", "not logging in", "access denied"],
        answer: "Let's get you back in. Here are the most common fixes:",
        steps: [
          "Make sure you're using the correct email address",
          "Try 'Forgot Password' on the login page to reset your password",
          "If you signed up with Google/Facebook, use that same login button — not email/password",
          "Clear your browser cache and cookies, then try again",
          "Try a different browser or incognito mode",
          "If none of these work, raise a support ticket and we'll sort it out",
        ],
        followUps: ["how do i reset my password", "i signed up with google", "my account is locked"],
        tags: ["error", "account", "blocked"],
        escalate: true,
      },
    ],
  },

  // ── MODULE: KYC ───────────────────────────────────────────────────────────
  {
    id: "kyc",
    icon: "🪪",
    label: "KYC Verification",
    subtopics: [
      {
        id: "what-is-kyc",
        question: "What is KYC and why do I need it?",
        keywords: ["kyc", "what is kyc", "why kyc", "identity", "verification", "why verify"],
        answer: "KYC (Know Your Customer) is a one-time identity verification required to trade carbon credits, access your wallet, and use advanced features. It keeps the platform secure and compliant with financial regulations.",
        followUps: ["how do i complete kyc", "what documents do i need", "how long does kyc take"],
        tags: ["kyc"],
      },
      {
        id: "how-to-complete-kyc",
        question: "How do I complete KYC?",
        keywords: ["complete kyc", "submit kyc", "kyc form", "how to kyc", "kyc process", "kyc steps", "do kyc"],
        answer: "Here's the step-by-step KYC process:",
        steps: [
          "Go to the KYC section from your sidebar or dashboard prompt",
          "Select your ID type — Aadhaar, PAN, Passport, or Voter ID",
          "Upload the front and back of your selected ID document (clear photo, under 5MB)",
          "Enter your full name exactly as it appears on the document",
          "Fill in your date of birth and address details",
          "Upload a selfie or live photo for face verification",
          "Review all details and click 'Submit KYC'",
          "Wait 1–2 business days for approval — you'll get an email notification",
        ],
        followUps: ["what documents are accepted", "how long does kyc take", "my kyc was rejected"],
        tags: ["kyc"],
      },
      {
        id: "kyc-documents",
        question: "What documents are accepted for KYC?",
        keywords: ["kyc documents", "accepted documents", "what documents", "id proof", "aadhaar", "pan", "passport"],
        answer: "EtherTrack accepts the following government-issued IDs for KYC:",
        steps: [
          "Aadhaar Card (front + back)",
          "PAN Card",
          "Passport (bio page)",
          "Voter ID (front + back)",
          "Documents must be clear, unblurred, and fully visible",
          "File size must be under 5MB per image (JPG, PNG, or PDF)",
        ],
        followUps: ["how do i complete kyc", "my kyc was rejected", "can i use a foreign passport"],
        tags: ["kyc"],
      },
      {
        id: "kyc-rejected",
        question: "My KYC was rejected. What do I do?",
        keywords: ["kyc rejected", "kyc failed", "kyc declined", "kyc not approved", "resubmit kyc", "kyc issue"],
        answer: "Don't worry — KYC rejections are usually fixable. Common reasons and fixes:",
        steps: [
          "Blurry or cropped document photo → retake with better lighting",
          "Name mismatch → ensure your name matches exactly as on the ID",
          "Expired document → use a valid, non-expired ID",
          "Wrong document type uploaded → re-read accepted document list",
          "Go back to the KYC form and resubmit with corrected documents",
          "If rejected again, raise a support ticket with your rejection reason",
        ],
        followUps: ["what documents are accepted", "how do i resubmit kyc", "how long does kyc take after resubmission"],
        tags: ["kyc", "error", "blocked"],
        escalate: true,
      },
      {
        id: "kyc-time",
        question: "How long does KYC approval take?",
        keywords: ["kyc time", "kyc approval time", "how long kyc", "kyc pending", "kyc status", "waiting for kyc"],
        answer: "KYC is typically reviewed and approved within 1–2 business days. You'll receive an email once approved. If it's been more than 2 business days, raise a support ticket so we can check the status.",
        followUps: ["my kyc is still pending", "how do i check kyc status", "kyc rejected what to do"],
        tags: ["kyc"],
        escalate: false,
      },
    ],
  },

  // ── MODULE: Wallet & Blockchain ───────────────────────────────────────────
  {
    id: "wallet",
    icon: "👛",
    label: "Wallet & Blockchain",
    subtopics: [
      {
        id: "connect-wallet",
        question: "How do I connect my wallet?",
        keywords: ["connect wallet", "wallet connect", "metamask", "web3", "bind wallet", "link wallet", "setup wallet"],
        answer: "Here's how to connect your Web3 wallet to EtherTrack:",
        steps: [
          "Make sure MetaMask (or a compatible wallet) is installed in your browser",
          "Go to Settings → Wallet Bind from the sidebar",
          "Click 'Connect Wallet' — your wallet extension will pop up",
          "Approve the connection request in MetaMask",
          "Sign the verification message (this doesn't cost gas — it's just a signature)",
          "Your wallet address is now linked to your EtherTrack account",
        ],
        followUps: ["which wallets are supported", "wallet mismatch error", "how do i disconnect my wallet"],
        tags: ["wallet"],
      },
      {
        id: "wallet-mismatch",
        question: "I see a wallet mismatch warning",
        keywords: ["wallet mismatch", "wrong wallet", "wallet error", "mismatch banner", "different wallet", "wallet not matching"],
        answer: "A wallet mismatch means the wallet active in your browser is different from the one linked to your account. Here's how to fix it:",
        steps: [
          "Open MetaMask and check which account is currently active",
          "Switch to the wallet address linked to your EtherTrack account",
          "If you've lost access to that wallet, go to Settings → Wallet Bind to update it",
          "Sign the new verification message to link the new wallet",
          "The mismatch banner will disappear once wallets are in sync",
        ],
        followUps: ["how do i change my linked wallet", "i lost access to my wallet", "wallet not connecting"],
        tags: ["wallet", "error"],
      },
      {
        id: "transactions",
        question: "How do I view my transactions?",
        keywords: ["view transactions", "transaction history", "tx history", "my transactions", "on-chain history", "past trades"],
        answer: "All your on-chain activity is tracked in one place. Here's how to access it:",
        steps: [
          "Click 'Transaction Status' in the sidebar",
          "You'll see all transactions — pending, confirmed, and failed",
          "Click any transaction to see its on-chain details and block explorer link",
          "Use filters to view by type — buy, sell, retire, transfer",
        ],
        followUps: ["why is my transaction pending", "transaction failed what do i do", "how do i get a transaction receipt"],
        tags: ["wallet"],
      },
      {
        id: "transaction-failed",
        question: "My transaction failed. What do I do?",
        keywords: ["transaction failed", "tx failed", "transaction error", "transaction not going through", "failed transaction", "transaction stuck"],
        answer: "Transaction failures are usually due to gas issues or network congestion. Here's what to check:",
        steps: [
          "Check if you have enough ETH in your wallet for gas fees",
          "Go to Transaction Status and check the exact error message",
          "If it shows 'Insufficient funds' — top up your ETH balance",
          "If it shows 'Nonce error' — reset your MetaMask account (Settings → Advanced → Reset Account)",
          "If the network is congested, wait a few minutes and retry",
          "If the transaction keeps failing, raise a support ticket with the transaction hash",
        ],
        followUps: ["how do i check my eth balance", "what are gas fees", "how do i get a refund for a failed transaction"],
        tags: ["wallet", "error", "blocked"],
        escalate: true,
      },
    ],
  },

  // ── MODULE: Carbon Credits ────────────────────────────────────────────────
  {
    id: "carbon-credits",
    icon: "🌿",
    label: "Carbon Credits",
    subtopics: [
      {
        id: "buy-credits",
        question: "How do I buy carbon credits?",
        keywords: ["buy credits", "purchase credits", "buy carbon", "marketplace", "get credits", "acquire credits"],
        answer: "Buying carbon credits on EtherTrack is fully on-chain. Here's how:",
        steps: [
          "Make sure your KYC is approved and wallet is connected",
          "Go to 'Marketplace' from the sidebar",
          "Browse listings — filter by project type, vintage year, or price",
          "Select a listing and enter the quantity you want to buy",
          "Review the total cost (credit price + gas fees)",
          "Click 'Buy' and confirm the transaction in MetaMask",
          "Credits will appear in your Portfolio once the transaction confirms",
        ],
        followUps: ["what are carbon credits", "how do i check my portfolio", "buy transaction failed"],
        tags: [],
      },
      {
        id: "sell-credits",
        question: "How do I sell or list carbon credits?",
        keywords: ["sell credits", "list credits", "sell carbon", "create listing", "put up for sale", "marketplace listing"],
        answer: "You need a Starter plan or above to list credits. Here's how to sell:",
        steps: [
          "Go to your Portfolio and select the credits you want to sell",
          "Click 'List for Sale'",
          "Set your price per credit (in ETH or INR equivalent)",
          "Set the quantity you want to list",
          "Review and confirm — the listing goes live on the Marketplace immediately",
          "You'll be notified when a buyer purchases your credits",
        ],
        followUps: ["what plan do i need to sell", "how do i cancel a listing", "when do i get paid"],
        tags: ["billing"],
      },
      {
        id: "retire-credits",
        question: "How do I retire carbon credits?",
        keywords: ["retire credits", "retirement", "offset", "cancel credits", "burn credits", "neutralize"],
        answer: "Retiring credits permanently removes them from circulation as a carbon offset. Here's how:",
        steps: [
          "Go to your Portfolio from the sidebar",
          "Select the credits you want to retire",
          "Click 'Retire' (or 'Bulk Retire' for multiple batches)",
          "Add a retirement reason / beneficiary name (optional but recommended)",
          "Confirm the transaction in MetaMask",
          "Once confirmed, your Retirement Certificate is generated automatically",
        ],
        followUps: ["how do i get my certificate", "can i undo a retirement", "what is bulk retire"],
        tags: [],
      },
      {
        id: "certificate",
        question: "How do I get my retirement certificate?",
        keywords: ["certificate", "retirement certificate", "pdf certificate", "proof of retirement", "download certificate", "get certificate"],
        answer: "Your certificate is auto-generated after every retirement. Here's how to access it:",
        steps: [
          "Go to 'Retirement Certificate' in the sidebar",
          "Find your retirement record by date or project",
          "Click 'Download PDF' to get your certificate",
          "The certificate includes: credit details, retirement date, on-chain hash, and beneficiary name",
          "You can also share a public verification link — anyone can verify it at /verify/[certId]",
        ],
        followUps: ["how do i verify a certificate", "my certificate is not generating", "can i add my company name to the certificate"],
        tags: [],
      },
    ],
  },

  // ── MODULE: Emissions Tracking ────────────────────────────────────────────
  {
    id: "emissions",
    icon: "📊",
    label: "Emissions Tracking",
    subtopics: [
      {
        id: "log-emissions",
        question: "How do I log my emissions?",
        keywords: ["log emissions", "add emission", "track emissions", "ghg", "scope 1", "scope 2", "scope 3", "co2", "carbon footprint", "emission entry"],
        answer: "Emissions tracking is available on the Growth plan and above. Here's how to log:",
        steps: [
          "Go to 'Emission Tracking' from the sidebar",
          "Click 'Add Emission Entry'",
          "Select the Scope — Scope 1 (direct), Scope 2 (electricity), or Scope 3 (value chain)",
          "Choose the activity category (e.g. fuel combustion, business travel, purchased goods)",
          "Enter the quantity and unit (litres, kWh, km, tonnes, etc.)",
          "Add the date and any notes",
          "Click Save — the entry is added to your GHG inventory ledger",
        ],
        followUps: ["what is scope 1 2 3", "how do i generate a ghg report", "can i import emissions from csv"],
        tags: [],
      },
      {
        id: "scope-types",
        question: "What is the difference between Scope 1, 2, and 3?",
        keywords: ["scope 1", "scope 2", "scope 3", "difference", "what is scope", "emission scope", "ghg scope"],
        answer: "Here's a quick breakdown of the three GHG emission scopes:",
        steps: [
          "Scope 1 — Direct emissions from sources you own/control (company vehicles, on-site fuel burning)",
          "Scope 2 — Indirect emissions from purchased electricity, heat, or steam",
          "Scope 3 — All other indirect emissions across your value chain (business travel, supply chain, product use)",
          "Most companies start with Scope 1 & 2, then add Scope 3 over time",
          "EtherTrack supports all three scopes with GHG Protocol-aligned calculations",
        ],
        followUps: ["how do i log scope 3", "what plan includes emissions tracking", "how do i generate a ghg report"],
        tags: [],
      },
      {
        id: "brsr",
        question: "What is the BRSR report and how do I generate it?",
        keywords: ["brsr", "brsr report", "business responsibility", "sustainability report", "esg report", "generate report", "compliance report"],
        answer: "BRSR is a mandatory ESG disclosure for listed Indian companies. EtherTrack auto-generates it from your logged data:",
        steps: [
          "Make sure all your emissions data is logged for the reporting period",
          "Go to 'Reports' from the sidebar",
          "Select 'BRSR Report' and choose the financial year",
          "Review the auto-filled data — edit any fields if needed",
          "Click 'Generate PDF' to download your BRSR-compliant report",
          "The report includes environmental KPIs, energy consumption, and GHG data",
        ],
        followUps: ["what data do i need for brsr", "is brsr mandatory for my company", "what other reports does ethertrack generate"],
        tags: [],
      },
    ],
  },

  // ── MODULE: Plans & Billing ───────────────────────────────────────────────
  {
    id: "subscription",
    icon: "💳",
    label: "Plans & Billing",
    subtopics: [
      {
        id: "plans-overview",
        question: "What plans does EtherTrack offer?",
        keywords: ["plans", "pricing", "subscription", "tiers", "what plans", "free plan", "starter", "growth", "corporate", "how much"],
        answer: "EtherTrack has 4 plans to suit different organization sizes:",
        steps: [
          "Free — Dashboard, carbon credit buying, trading history, wallet",
          "Starter (₹1,000/mo) — Everything in Free + Portfolio management, listing & selling credits, 3 seats",
          "Growth (₹10,000/mo) — Everything in Starter + Scope 1/2/3 emissions tracking, GHG reports, analytics, 10 seats",
          "Corporate (Contact Sales) — Everything in Growth + BRSR/CDP/TCFD reports, audit trail, PAT/CCTS compliance, multi-entity, custom seats",
        ],
        followUps: ["how do i upgrade", "what features are in growth plan", "how do i contact sales for corporate"],
        tags: ["billing"],
      },
      {
        id: "upgrade-plan",
        question: "How do I upgrade my plan?",
        keywords: ["upgrade plan", "change plan", "switch plan", "upgrade subscription", "get starter", "get growth", "buy plan"],
        answer: "Upgrading your plan takes just a minute. Here's how:",
        steps: [
          "Go to Settings → Subscription & Billing from the sidebar",
          "Click 'Change Plan' or 'Upgrade'",
          "Select your desired plan and review what's included",
          "Enter your payment details and confirm",
          "Your new plan activates immediately — no restart needed",
        ],
        followUps: ["what payment methods are accepted", "can i downgrade my plan", "will i lose data if i downgrade"],
        tags: ["billing"],
      },
      {
        id: "billing-issues",
        question: "I'm having a billing or payment issue",
        keywords: ["billing issue", "payment failed", "payment not going through", "charged wrong", "refund", "invoice", "receipt", "billing error"],
        answer: "For billing issues, here's what to try:",
        steps: [
          "Go to Settings → Subscription & Billing to check your current plan and payment status",
          "If a payment failed, check if your card details are up to date",
          "Try a different payment method if your card is being declined",
          "For incorrect charges or refund requests, raise a support ticket immediately",
          "For invoices, go to Billing → Invoice History to download past invoices",
        ],
        followUps: ["how do i get a refund", "how do i update my payment method", "how do i download my invoice"],
        tags: ["billing", "error"],
        escalate: true,
      },
    ],
  },

  // ── MODULE: Organization & Team ───────────────────────────────────────────
  {
    id: "org",
    icon: "🏢",
    label: "Organization & Team",
    subtopics: [
      {
        id: "create-org",
        question: "How do I create an organization?",
        keywords: ["create org", "create organization", "new organization", "setup company", "register company", "org setup"],
        answer: "You need to complete KYC before creating an org. Here's the process:",
        steps: [
          "Complete and get your KYC approved first",
          "Go to 'Join or Create Organization' from the sidebar or dashboard prompt",
          "Click 'Create New Organization'",
          "Fill in your company name, type, industry, and registration number",
          "Upload your company registration document (GST certificate, MCA filing, etc.)",
          "Submit — your org will be reviewed and activated within 1–2 business days",
          "Once active, you can invite team members and start using org features",
        ],
        followUps: ["how do i invite team members", "what documents do i need for org creation", "can i join an existing org instead"],
        tags: ["account"],
      },
      {
        id: "invite-team",
        question: "How do I invite team members?",
        keywords: ["invite team", "add member", "team member", "invite user", "add user", "team management", "give access"],
        answer: "Here's how to invite teammates to your organization:",
        steps: [
          "Go to 'Team Management' from the sidebar",
          "Click 'Invite Member'",
          "Enter the email address of the person you want to invite",
          "Select their role — Admin, Analyst, or Viewer",
          "Click Send Invite — they'll receive an email with a join link",
          "Once they accept, they'll appear in your team list",
          "You can change roles or remove members anytime from Team Management",
        ],
        followUps: ["what are the different roles", "how do i remove a team member", "my invite link is expired"],
        tags: ["account"],
      },
      {
        id: "join-org",
        question: "How do I join an existing organization?",
        keywords: ["join org", "join organization", "accept invite", "org invite", "join team", "invited to org"],
        answer: "Joining an org is done through an invite link sent by the org admin:",
        steps: [
          "Ask your org admin to send you an invite from Team Management",
          "You'll receive an email with a 'Join Organization' link",
          "Click the link — if you don't have an EtherTrack account, you'll be prompted to sign up first",
          "After signing up / logging in, you'll be automatically added to the org",
          "Complete KYC if you haven't already to unlock all features",
        ],
        followUps: ["my invite link is expired", "i didn't receive the invite email", "can i be in multiple organizations"],
        tags: ["account"],
      },
    ],
  },

  // ── ADD NEW MODULES BELOW THIS LINE ───────────────────────────────────────
];

// ─────────────────────────────────────────────────────────────────────────────
// INTENT PATTERNS — used by the chat engine for smart replies
// Add phrases that signal frustration, errors, or escalation needs
// ─────────────────────────────────────────────────────────────────────────────
export const INTENT_PATTERNS = {
  frustration: ["not working", "doesn't work", "broken", "bug", "issue", "problem", "stuck", "can't", "cannot", "failed", "error", "wrong", "help me", "urgent", "asap"],
  greeting:    ["hi", "hello", "hey", "hii", "good morning", "good evening", "howdy", "sup", "yo"],
  thanks:      ["thank", "thanks", "thank you", "thx", "ty", "appreciate", "helpful", "great", "awesome", "perfect"],
  escalate:    ["human", "agent", "person", "support", "talk to someone", "real person", "escalate", "ticket", "raise ticket"],
  confusion:   ["confused", "don't understand", "what does", "what is", "explain", "what do you mean", "unclear"],
};

// ─────────────────────────────────────────────────────────────────────────────
// BOT PERSONA — controls how the assistant introduces and presents itself
// ─────────────────────────────────────────────────────────────────────────────
export const BOT_PERSONA = {
  name:        "Ethi",
  tagline:     "EtherTrack Support Assistant",
  greeting:    "Hey! 👋 I'm Ethi, your EtherTrack support assistant. I know everything about the app — ask me anything or pick a topic below!",
  notFound:    "Hmm, I don't have a specific answer for that yet. Try rephrasing, or I can connect you with our support team.",
  escalateMsg: "It looks like you might need human help for this one. Want me to raise a support ticket?",
};