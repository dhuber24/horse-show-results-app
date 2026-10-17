/**
 * The public FAQ (`/faq`): its questions, grouped by who is asking, and the
 * helpers the page uses to render, search and mark them up.
 *
 * **Every answer is a thing the app does today, in the words its screens use**
 * ("My Shows", "What I Owe", "Add/Drop Classes") — the same rule as the welcome
 * email (`backend/welcome_email.py`). An answer that promises a screen nobody
 * can find is the first thing a reader learns not to trust, so when a screen
 * or a rule changes, the answer that describes it changes with it.
 *
 * An answer is a list of blocks: a string is a paragraph, an array of strings
 * a bulleted list. `[label](/path)` inside either is a link, and only a
 * same-site path — the test pins that.
 */

export type FaqBlock = string | string[];

export interface FaqItem {
  /** The anchor — `/faq#{id}` opens this question. Never reuse or rename one;
   *  people share these links. */
  id: string;
  q: string;
  a: FaqBlock[];
}

export interface FaqCategory {
  id: string;
  title: string;
  icon: string;
  blurb: string;
  items: FaqItem[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: 'about',
    title: 'About GaitDesk',
    icon: '🐴',
    blurb: 'What GaitDesk is, and what it is not.',
    items: [
      {
        id: 'what-is-gaitdesk',
        q: 'What is GaitDesk?',
        a: [
          'GaitDesk runs the paperwork side of ranch and western pleasure horse shows. Exhibitors sign up and enter classes online, the show office works the registration desk and the bills, scribes record what the judge calls, and results go up live for everyone to follow.',
        ],
      },
      {
        id: 'need-an-account',
        q: 'Do I need an account?',
        a: [
          'Not to follow a show. Class schedules, results, patterns, show bills and high-point standings are open to everyone, with no sign-in.',
          'You need an account to enter a show, or to work one as show staff.',
        ],
      },
      {
        id: 'does-gaitdesk-judge',
        q: 'Does GaitDesk judge the classes?',
        a: [
          'No. Judges judge. A scribe records what the judge calls — placings, or the maneuver scores and penalties on a judge\'s card — and GaitDesk adds the card up. It never decides what a maneuver is worth or which penalty applies.',
          'GaitDesk does not replace an association\'s own rules or its review of results.',
        ],
      },
      {
        id: 'phone',
        q: 'Can I use GaitDesk on my phone?',
        a: [
          'Yes. GaitDesk is built for a phone at the rail or in the barn aisle. Most phones also let you add it to your home screen from the browser\'s Share or menu button, so it opens like an app.',
        ],
      },
      {
        id: 'associations',
        q: 'Which associations does GaitDesk work with?',
        a: [
          'Shows on GaitDesk may be approved by a breed association such as APHA or AQHA, sanctioned by clubs, or run as open shows. GaitDesk checks some association details where it holds the information — AQHA class codes and membership numbers, for example — but the association\'s own rules always govern.',
        ],
      },
      {
        id: 'contact-gaitdesk',
        q: 'How do I contact GaitDesk?',
        a: [
          'Use the [contact form](/contact) — you don\'t need an account. We reply by email.',
          'For anything about a particular show — entries, stalls, a bill or a result — message that show\'s office instead: open the show and choose Message the Show Office.',
        ],
      },
    ],
  },
  {
    id: 'spectators',
    title: 'Spectators & Fans',
    icon: '👀',
    blurb: 'Following a show from the rail, the stands or home.',
    items: [
      {
        id: 'find-a-show',
        q: 'How do I find a show?',
        a: [
          'Start from the [home page](/). [Active Shows](/shows/active) are running now, [Upcoming Shows](/shows/upcoming) are open for sign-up, and [Past Shows](/shows/past) keep their results. Upcoming and past shows can be searched by name, venue, show type and date.',
        ],
      },
      {
        id: 'live-results',
        q: 'How do I follow results live?',
        a: [
          'Open the show and choose Results. Each class appears with its placings as soon as it is posted.',
          'Results stay private while they are being entered, so a class can finish in the arena a few minutes before its placings go up.',
        ],
      },
      {
        id: 'find-a-rider',
        q: 'How do I find one rider\'s or one horse\'s results?',
        a: [
          'On a show\'s Results page, filter by Name, Back #, Horse or Class. Every box you fill in has to match the same placing, so a rider\'s name and a horse together find that pair.',
          'A back number matches the whole number: 14 won\'t find 142.',
        ],
      },
      {
        id: 'class-schedule',
        q: 'Where is the class schedule?',
        a: [
          'Choose Class Schedule on the show\'s page. It lists each day\'s classes ring by ring. Open a class to see who is entered: back number, horse, rider, owner, sire and dam.',
          'Placings are on the Results page, not the schedule.',
        ],
      },
      {
        id: 'schedule-badges',
        q: 'What do "In the ring", "Up next" and "Done" mean?',
        a: [
          'They come from the in-gate as the show runs:',
          [
            'In the ring — the gate has started the class. When classes run together, more than one can be in the ring at once.',
            'Up next — the next class in that ring.',
            'Done — the gate has finished the class, or its results are posted.',
          ],
        ],
      },
      {
        id: 'favorites',
        q: 'Can I keep track of just the classes I care about?',
        a: [
          'Yes. Tap the star beside a class on the schedule, then use ★ Favorites to show only the classes you starred.',
          'Stars are saved on your device, not to an account. They\'ll be there next time on the same phone or browser, but not on a different one.',
        ],
      },
      {
        id: 'patterns',
        q: 'Where can I see the patterns?',
        a: [
          'Choose Patterns on the show\'s page to view or download every pattern the show has posted. Patterns often arrive in the days before a show, so check back if one isn\'t up yet.',
        ],
      },
      {
        id: 'high-point',
        q: 'How do high-point standings work?',
        a: [
          'At a show that runs high point, the Leaderboard ranks horses and riders by the points they\'ve earned in posted classes, using the points chart the show chose. The chart is on the same page, under How points are earned.',
          'Some shows also belong to a season circuit, with standings added up across every show in it.',
        ],
      },
      {
        id: 'show-bill',
        q: 'What is the show bill?',
        a: [
          'The show\'s published program: its judges, classes, schedule and fees. Choose Show Bill on the show\'s page. Some shows post their own printed bill, with a button to download it.',
        ],
      },
      {
        id: 'arena-qr-code',
        q: 'What is the QR code on the arena screen for?',
        a: [
          'It opens the show\'s Results page on your phone, so you can look up any placing without typing anything.',
        ],
      },
      {
        id: 'contact-a-show',
        q: 'How do I contact a show?',
        a: [
          'Choose Message the Show Office on the show\'s page. You don\'t need an account. Your message goes to that show\'s office, and they reply by email, so double-check the address you give.',
          'GaitDesk doesn\'t run the shows listed here; each show\'s own office answers questions about it. To reach GaitDesk itself, use the [contact form](/contact).',
        ],
      },
      {
        id: 'placing-changed',
        q: 'Why did a placing change after it was posted?',
        a: [
          'The show office can correct a posted result — a typing mistake, say, or a call the judge revised. Every change to a posted result is kept in the show\'s audit history.',
        ],
      },
    ],
  },
  {
    id: 'exhibitors',
    title: 'Exhibitors',
    icon: '🏇',
    blurb: 'Signing up, entering classes, horses, back numbers and your bill.',
    items: [
      {
        id: 'create-account',
        q: 'How do I create an account?',
        a: [
          '[Create an exhibitor account](/register) with your name, email and a password. If you start from a show\'s sign-up button instead, you\'ll come straight back to that show once your account is made.',
        ],
      },
      {
        id: 'enter-a-show',
        q: 'How do I enter a show?',
        a: [
          'Open the show from [Upcoming Shows](/shows/upcoming) and choose Sign up. Registration runs in order:',
          [
            'Your details — contact information, date of birth, an emergency contact, and at least one horse.',
            'Stalls, shavings and camping — at shows that sell them.',
            'Your classes and back number — on a page of their own, which you can come back to as often as you like.',
          ],
        ],
      },
      {
        id: 'date-of-birth',
        q: 'Why does registration ask for my date of birth?',
        a: [
          'Youth and age divisions are decided by it, and nobody at the show office can look it up for you.',
          'Exhibitors under 18 on the first day of the show also need a parent or guardian\'s name and phone number.',
        ],
      },
      {
        id: 'details-per-show',
        q: 'If I change my details while registering, does my profile change too?',
        a: [
          'No. Your profile fills in each registration for you, but what you change during one show\'s registration stays with that show. To change what future registrations start with, update [My Account](/profile).',
        ],
      },
      {
        id: 'add-horses',
        q: 'How do I add my horses?',
        a: [
          'Under [My Account](/profile?tab=horses), open My Horses and add each horse by its registered name. Upload its papers — registration, Coggins, health certificate — so the show office can check them before you reach the desk.',
        ],
      },
      {
        id: 'someone-elses-horse',
        q: 'I show a horse somebody else owns. How do I add it?',
        a: [
          'Search for the horse and ask to link it. If its owner is on GaitDesk, they approve the request before the horse appears on your profile. You\'re given the approval link to send them yourself, in case the email doesn\'t arrive.',
          'If the owner can\'t be reached through GaitDesk, the show office can add the horse for you at the desk.',
        ],
      },
      {
        id: 'find-a-trainer',
        q: 'How do I find a trainer?',
        a: [
          'Open the [Trainer Registry](/trainers) and enter your zip code, or choose Use my location, to see trainers near you — featured trainers first, nearest first. You can also search by name, barn, town or discipline.',
          'Contact a trainer directly from their listing. GaitDesk doesn\'t book or vet trainers.',
        ],
      },
      {
        id: 'transfer-a-horse',
        q: 'I sold my horse. How do I transfer it?',
        a: [
          'Open the horse under [My Account](/profile?tab=horses) and transfer it to the new owner. They need a GaitDesk account, and the horse moves once they accept. An unanswered request expires after 30 days.',
        ],
      },
      {
        id: 'paperwork-before-entering',
        q: 'Do I need my Coggins and memberships on file before I can enter?',
        a: [
          'No. Missing or expiring health papers and association memberships are flagged for the show office, never used to refuse your entry. Bring them to the show and the office will check them at the desk.',
          'Uploading papers and adding your membership numbers ahead of time saves you a stop at the counter.',
        ],
      },
      {
        id: 'back-number',
        q: 'How do I get a back number?',
        a: [
          'On your class registration page you can ask for a number. If nobody else at the show has it, it\'s yours straight away. You can ask while the show is open for sign-up; after that, numbers are printed and the office handles any change.',
          'Some shows number each horse rather than each rider. There, each of your horses wears its own number.',
        ],
      },
      {
        id: 'add-drop-classes',
        q: 'Can I add or scratch classes after I sign up?',
        a: [
          'Yes — choose Add/Drop Classes on the show\'s page. Once the show is running you can usually still enter a class until it starts, and scratch from one until it finishes.',
          'Some shows stop class changes when the show starts. There, ask the show office.',
        ],
      },
      {
        id: 'missed-deadline',
        q: 'I missed the online sign-up deadline. Can I still enter?',
        a: [
          'Each show sets the last day to sign up online. After it, the show\'s sign-up button becomes a message to the show office — ask them whether they are still taking entries at the desk.',
        ],
      },
      {
        id: 'championship-classes',
        q: 'Why can\'t I enter a championship or Grand & Reserve class?',
        a: [
          'You qualify for those by placing in other classes, so they can\'t be entered ahead of time. The show office enters the horses the judge calls back. The class picker says how many classes it left out and why.',
        ],
      },
      {
        id: 'two-horses-one-class',
        q: 'Can I show two horses in the same class?',
        a: [
          'Only in pattern classes, where each horse rides its own run and gets its own score and entry fee. In other classes it\'s one horse per rider.',
        ],
      },
      {
        id: 'cancel-registration',
        q: 'How do I cancel my registration?',
        a: [
          'Use Cancel my registration at the foot of the My Registration page. You can cancel yourself while the show is open for sign-up, up to the cut-off its show company set — some allow it until the show starts, others close it some days before. After that, message the show office and they\'ll do it for you.',
          'Cancelling takes off your classes, stalls, futurity nominations and side pot buy-ins. Any payment you\'ve already made stays on record for the office to refund.',
        ],
      },
      {
        id: 'paying',
        q: 'How do I pay? Can I pay through GaitDesk?',
        a: [
          'GaitDesk doesn\'t take payments. What I Owe on the show\'s page shows your itemized bill — class fees, stalls, shavings and the show\'s other charges — and you pay the show office the way they ask.',
        ],
      },
      {
        id: 'early-rates',
        q: 'If I book at the early rate, will the price go up when the deadline passes?',
        a: [
          'No. An early rate is locked in on the day you book each item.',
        ],
      },
      {
        id: 'waivers',
        q: 'Do I sign the entry blank and releases online?',
        a: [
          'Where a show posts them, yes: you read and sign them after you sign up, by typing your name. If you sign the paper copy instead, the show office records it at the desk.',
        ],
      },
      {
        id: 'my-shows',
        q: 'Where can I see everything I\'ve entered?',
        a: [
          'My Shows, in the top bar once you\'re signed in, lists every show you\'ve signed up for. Each opens the show\'s page with your own options on top: Add/Drop Classes, My Registration and What I Owe.',
          'On a show\'s Results page, My classes narrows the list to the classes you\'re entered in.',
        ],
      },
      {
        id: 'past-results',
        q: 'Where are my past results?',
        a: [
          'Under [My Account](/profile?tab=history), Show History lists your past shows, each with links to its results and schedule.',
        ],
      },
    ],
  },
  {
    id: 'trainers',
    title: 'Trainers',
    icon: '🤠',
    blurb: 'Your trainer profile, the horses you train, and showing yourself.',
    items: [
      {
        id: 'trainer-account',
        q: 'Do I need a trainer account?',
        a: [
          'A trainer account gives you a trainer profile — the record owners and show offices choose when they name you as a horse\'s trainer. You don\'t need one to show. You can [register as a trainer](/register/trainer) at any time.',
        ],
      },
      {
        id: 'horses-i-train',
        q: 'How do I see the horses I train?',
        a: [
          'The Horses tab under [My Account](/profile) lists every horse whose record names you as its trainer. Who trains a horse is its owner\'s call, so a horse appears there once its owner names you.',
        ],
      },
      {
        id: 'public-profile',
        q: 'What goes on my public profile?',
        a: [
          'It\'s public only while you\'re listed in the [Trainer Registry](/trainers). A Basic listing shows your name, business, town and the disciplines you train. On Pro it carries a Featured tag and also shows your bio, headshot, logo, photos, video links, rate sheet, website, social links, association cards and SafeSport, background-check and insurance badges, with a Call button and a Contact Trainer form.',
          'Your login email, private phone and zip code are never on it, and nor is your public email — the Contact Trainer form sends messages to it without showing it.',
        ],
      },
      {
        id: 'trainer-registry',
        q: 'How do I advertise in the Trainer Registry?',
        a: [
          'Tick List me in the Trainer Registry when you [register as a trainer](/register/trainer), or tick List in Trainer Registry under [My Account](/profile) if you already have an account. Your listing needs your town, state, zip code and at least one discipline.',
          'Your listing has its own page you can share. Untick the box under My Account to take it down.',
        ],
      },
      {
        id: 'trainer-registry-pro',
        q: 'What do I get with Trainer Registry Pro, and how do I pay?',
        a: [
          'Basic is free. Pro puts you above Basic listings and nearest-first for exhibitors searching near you, with your distance shown, and adds photos, video links, your rate sheet and a Contact Trainer button whose messages are emailed to you and kept on your registry page. Sign in to your trainer account to compare the plans and their prices on your [Trainer Registry page](/profile/registry).',
          'GaitDesk doesn\'t take payment in the app. Choose Upgrade to Pro on your [Trainer Registry page](/profile/registry), and GaitDesk gets in touch to arrange it. Your listing switches to Pro once it\'s set up, and back to Basic if Pro runs out — nothing you added is lost.',
        ],
      },
      {
        id: 'safesport',
        q: 'Why does my profile ask for SafeSport and background-check dates?',
        a: [
          'So they\'re kept in one place with your record. GaitDesk records the dates you enter; it doesn\'t verify them with anyone.',
        ],
      },
      {
        id: 'trainer-memberships',
        q: 'Where do I add my association memberships?',
        a: [
          'Under My Account, in Affiliations — with your status (professional or non-pro) for each association.',
        ],
      },
      {
        id: 'trainer-also-shows',
        q: 'I train and I show. Can I enter classes too?',
        a: [
          'Yes. Follow a show\'s sign-up button. If your account isn\'t set up to enter shows yet, GaitDesk sends you to a page where you tick I also compete, then brings you back to the show.',
        ],
      },
      {
        id: 'entering-clients',
        q: 'Can I enter my clients in a show?',
        a: [
          'Not from your trainer account. Each exhibitor signs up from their own account, or the show office enters them at the registration desk.',
        ],
      },
    ],
  },
  {
    id: 'show-office',
    title: 'Show Managers & Secretaries',
    icon: '🗂️',
    blurb: 'Setting up and running a show from the office.',
    items: [
      {
        id: 'office-getting-started',
        q: 'How do we start running our shows on GaitDesk?',
        a: [
          'Register as a [Show Manager](/register/show-manager) or a [Show Secretary](/register/show-secretary). You can name your club or company as you register: a new name sets up your organization, and a request to join one already on GaitDesk is approved by a GaitDesk administrator.',
          'Questions first? [Contact GaitDesk](/contact?topic=running_shows).',
        ],
      },
      {
        id: 'pricing',
        q: 'How much does GaitDesk cost for our shows?',
        a: [
          '[Contact GaitDesk](/contact?topic=pricing) and tell us a little about your shows — how many you run and roughly how many entries — and we\'ll get back to you.',
        ],
      },
      {
        id: 'manager-vs-secretary',
        q: 'What\'s the difference between a show manager and a show secretary?',
        a: [
          'A show manager creates shows, runs them and assigns their staff. A show secretary runs the office for the shows they work: classes, entries, back numbers, results and the registration desk. Both can manage their company\'s staff list under My Company Staff.',
        ],
      },
      {
        id: 'show-company',
        q: 'What is a show company?',
        a: [
          'The club or business that runs your shows. Everyone in a company can work its shows from the office, and paid features are switched on for a whole company. Managers and secretaries can ask for colleagues to be added; a GaitDesk administrator approves each one.',
        ],
      },
      {
        id: 'show-setup',
        q: 'How do I set up a show?',
        a: [
          'Create the show and the setup wizard walks you through it, one step at a time: Basics & Staff, Judges, Lodging, Class Builder, Sanctioning, Futurities & Side Pots, Fees, Scoring, Paperwork and Show Bill. A step that doesn\'t apply to your show can be skipped.',
        ],
      },
      {
        id: 'publishing',
        q: 'When can exhibitors see and sign up for our show?',
        a: [
          'Once you publish it — a draft is hidden from the public. Publishing needs a venue, at least one class, and answers to two questions:',
          [
            'The last day exhibitors can sign up online.',
            'Until when exhibitors can enter and scratch their own classes — until each class starts, or until the show starts.',
          ],
        ],
      },
      {
        id: 'show-bill-import',
        q: 'Can GaitDesk set up a show from our printed show bill?',
        a: [
          'Yes, as a paid feature. Upload your show bill and GaitDesk reads it into a draft — details, judges, classes and fees — for you to check and correct. Nothing it reads is saved until you create the show.',
          'If your company doesn\'t have it yet, the Request upgrade button on your show list asks a GaitDesk administrator.',
        ],
      },
      {
        id: 'registration-desk',
        q: 'What is the registration desk?',
        a: [
          'One screen per exhibitor: their sign-up, classes, back number, paperwork check-in and balance. Anything the desk still needs to check is outlined in red and says what to do.',
        ],
      },
      {
        id: 'walk-ups',
        q: 'Can we enter somebody who doesn\'t have an account?',
        a: [
          'Yes. At the registration desk a walk-up needs only a first and last name. You can take their contact details, add their horses, enter their classes and record their payments without them ever creating an account.',
        ],
      },
      {
        id: 'paperwork-flags',
        q: 'Does GaitDesk stop an entry when paperwork is missing?',
        a: [
          'No. Missing or lapsed health papers, memberships and horse registrations are flagged for the desk to sort out, never used to refuse an entry.',
          'Your show chooses which papers it requires and which ones the desk inspects. Once staff sign a paper off, the horse is in good standing for that show.',
        ],
      },
      {
        id: 'number-horses',
        q: 'Can we give back numbers to horses instead of riders?',
        a: [
          'Yes. Each show numbers either its exhibitors or its horses. Exhibitors can ask for a number while the show is open for sign-up; the desk can renumber anybody, and auto-assign fills in the rest.',
        ],
      },
      {
        id: 'posting-results',
        q: 'How do results get from the ring to the public?',
        a: [
          'Scribes enter placings or judges\' cards at the ring, and their screens save into a draft as they go. Nothing is public until the class is posted. After that, every change to the class\'s results is kept in its audit history.',
        ],
      },
      {
        id: 'payments-office',
        q: 'Does GaitDesk process payments?',
        a: [
          'No. GaitDesk builds each exhibitor\'s bill from your fees and records the payments your office collects. Financials shows what has been billed, collected and is still owing, and its reports print or export to CSV.',
        ],
      },
      {
        id: 'show-record',
        q: 'What can we send to the association after the show?',
        a: [
          'Show Record holds the results, class summary, entry cards, judges\' cards and compliance reports, and a printable bundle of the show\'s record to keep on file. Results reports include only posted classes.',
          'The judges\' signed paper cards remain the official record.',
        ],
      },
      {
        id: 'arena-screens',
        q: 'Can we put results on a TV at the arena?',
        a: [
          'Yes. Live Screens on the show\'s dashboard opens a full-screen Results Board, a Results & High Point board, and a Gate Board for a ring\'s in-gate. Sign in once on the TV\'s browser and leave it running.',
        ],
      },
      {
        id: 'high-point-circuits',
        q: 'Can we run high point and season circuits?',
        a: [
          'Yes. Choose a points chart for the show — a GaitDesk standard chart, one of your company\'s own, or a custom one — and the show\'s public Leaderboard keeps the standings. A season circuit adds the standings up across several shows.',
        ],
      },
      {
        id: 'side-pots-futurities',
        q: 'Does GaitDesk handle side pots and futurities?',
        a: [
          'Yes. Side pots take buy-ins, show live standings and projected payouts, and are settled once their classes are done. Futurities have their own entry form, nominations and Hi-Point standings. Buy-ins and nominations go on the exhibitor\'s bill.',
        ],
      },
      {
        id: 'office-messages',
        q: 'Where do messages from exhibitors and the public go?',
        a: [
          'To the show\'s inbox — the envelope in the top bar. A message from somebody signed in and entered at the show carries their back number. You reply from your own email.',
        ],
      },
      {
        id: 'invite-staff',
        q: 'How do we add scribes and gate stewards?',
        a: [
          'Invite them from Basics & Staff, the first step of the show\'s setup. Each gets a link to set their own password and arrives already assigned to your show. Add a co-manager there too, so somebody else can run the show if you can\'t.',
        ],
      },
      {
        id: 'association-rules',
        q: 'Does GaitDesk enforce association rules?',
        a: [
          'Only where it holds the information to check — for example AQHA class codes, registration and membership numbers, and some age checks. It flags problems for your office; it doesn\'t replace the association\'s own rules or review.',
        ],
      },
      {
        id: 'desktop-layout',
        q: 'Can I work on a laptop?',
        a: [
          'Yes. Office accounts open on a desktop layout with a menu down the side. On a phone, the Mobile view button in the top bar switches layouts.',
        ],
      },
    ],
  },
  {
    id: 'ring-crew',
    title: 'Scribes, Gate Stewards & Judges',
    icon: '📋',
    blurb: 'Working the ring and the in-gate on show day.',
    items: [
      {
        id: 'crew-access',
        q: 'How do I get access to a show as a scribe or gate steward?',
        a: [
          'The show office invites you from the show\'s setup. Follow the link to set your password, and the show will already be on your list. If you sign in and your show isn\'t there, ask the show secretary to assign you.',
        ],
      },
      {
        id: 'scribe-saving',
        q: 'As a scribe, how do I save?',
        a: [
          'You don\'t need to: your screen saves as you go, and there is no Save button. Placings stay a draft until the class is posted, so nothing goes public half-entered.',
        ],
      },
      {
        id: 'judges-card',
        q: 'What does the judge\'s card do?',
        a: [
          'You mark each maneuver score and penalty the judge calls, and GaitDesk adds up the card. If a total looks wrong, the judge\'s call stands — tell the show office rather than changing a score. The office can override a total, and the override is recorded.',
        ],
      },
      {
        id: 'rider-missing',
        q: 'Why isn\'t a rider on my scribe screen?',
        a: [
          'Your screen lists the riders who went into the ring. A rider scratched or marked as a no-show at the gate is left off, unless they already have a placing.',
        ],
      },
      {
        id: 'ties',
        q: 'How are ties handled?',
        a: [
          'A tie is broken by ranking the tied entries, never by changing a score the judge called. A class with a tie left unbroken can still be posted with a shared place, once somebody confirms it.',
        ],
      },
      {
        id: 'gate-screen',
        q: 'What does the gate screen do?',
        a: [
          'It runs the in-gate for one show day: each class\'s order of go, checking riders in or marking them no-shows, and starting each class as it goes into the ring.',
        ],
      },
      {
        id: 'gate-check-in',
        q: 'When can I check riders in?',
        a: [
          'For any class that hasn\'t started, so you can work down the day as riders arrive. A class turns Ready on its own once every rider is checked in or marked a no-show.',
        ],
      },
      {
        id: 'no-show-vs-scratch',
        q: 'Is a no-show the same as a scratch?',
        a: [
          'No. A no-show stays entered and stays on the exhibitor\'s bill; it only records that they didn\'t ride. Scratching is the exhibitor\'s or the show office\'s decision, never the gate\'s.',
        ],
      },
      {
        id: 'class-order',
        q: 'Can I start classes out of order?',
        a: [
          'No. Only the next class in each ring can start, once it\'s ready, and starting it finishes the class ahead of it.',
          'For classes that run together, use Run with on the next class to start it alongside the one already in the ring. A class with nobody to ride it is skipped.',
        ],
      },
      {
        id: 'gate-undo',
        q: 'I tapped the wrong thing at the gate. Can I undo it?',
        a: [
          'Yes. Check-ins can be cleared, a start undone, and a finished class reopened — as long as a later class in that ring hasn\'t moved on past it.',
        ],
      },
      {
        id: 'gate-signal',
        q: 'What if I lose signal at the arena?',
        a: [
          'A tap that doesn\'t reach GaitDesk says so on screen, so you know to try again. While you\'re connected, the gate screen refreshes itself every 10 seconds.',
        ],
      },
      {
        id: 'judges',
        q: 'I\'m a judge. What does GaitDesk hold about me?',
        a: [
          'Your record in GaitDesk\'s judge registry: your name, contact details and association cards. Shows that hire you choose that record, so a correction made once reaches every show you work. If something on it is wrong, tell the show office that hired you.',
        ],
      },
    ],
  },
  {
    id: 'account-help',
    title: 'Account & Troubleshooting',
    icon: '🔑',
    blurb: 'Passwords, email, privacy, and when something looks wrong.',
    items: [
      {
        id: 'forgot-password',
        q: 'I forgot my password.',
        a: [
          'Use [Forgot password](/forgot-password) and answer your security question. If you never set one, [contact GaitDesk](/contact?topic=account) and an administrator can reset your password for you.',
          'Set a security question under [My Account](/profile) so you can reset it yourself next time.',
        ],
      },
      {
        id: 'change-name',
        q: 'How do I change my name?',
        a: [
          'Under [My Account](/profile). Changing your name there also changes the name your entries and results are printed under.',
        ],
      },
      {
        id: 'no-email',
        q: 'I didn\'t get an email from GaitDesk.',
        a: [
          'Check your spam folder. Nothing in GaitDesk depends on an email arriving: anything that needs a link, such as approving a horse, also shows the link on screen for you to copy and send yourself.',
        ],
      },
      {
        id: 'out-of-date',
        q: 'The app looks out of date, or isn\'t showing a change.',
        a: [
          'GaitDesk keeps a copy on your device so it opens quickly. Refresh the page — or close the app and open it again — to load the latest version.',
        ],
      },
      {
        id: 'report-a-problem',
        q: 'Something isn\'t working. How do I report it?',
        a: [
          '[Tell us](/contact?topic=problem) what you were doing, which page you were on, and on what device. If the problem is with a particular show\'s entries or results rather than the app, message that show\'s office instead.',
        ],
      },
      {
        id: 'what-is-public',
        q: 'What information about me is public?',
        a: [
          'If you enter a show, its public schedule and results show your name and back number, and your horse with its owner, sire and dam.',
          'Your contact details, date of birth and bill are not shown publicly. The office of each show you sign up for sees what it needs to run your entries.',
        ],
      },
    ],
  },
];

export interface FaqSegment {
  text: string;
  href?: string;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** A block of answer text split into plain runs and links. */
export function faqSegments(text: string): FaqSegment[] {
  const segments: FaqSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ text: text.slice(last, at) });
    segments.push({ text: match[1], href: match[2] });
    last = at + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** Answer text with the link markup taken out: for search and for the page's
 *  structured data, which carries text, not links. */
export function faqPlainText(blocks: FaqBlock[]): string {
  return blocks
    .flatMap((block) => (Array.isArray(block) ? block : [block]))
    .map((text) => text.replace(LINK, '$1'))
    .join(' ');
}

/**
 * The categories narrowed to the questions matching every word typed, in the
 * question or its answer, ignoring case. A category with nothing left is
 * dropped; an empty query returns everything.
 */
export function filterFaqs(categories: FaqCategory[], query: string): FaqCategory[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return categories;
  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        const haystack = `${item.q} ${faqPlainText(item.a)} ${category.title}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      }),
    }))
    .filter((category) => category.items.length > 0);
}
