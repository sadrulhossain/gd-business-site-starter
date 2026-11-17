// Sample business content ported from legacy SiteDataSeeder (Northwind Consulting). Loaded only by `seed --demo`.
// Row shapes — faqs [q, q2, a, a2]; services [title, title2, description, description2]; plans [name, name2, multiplier, desc, desc2, features, features2, featured];
// testimonials [author, role, role2, quote, quote2]; team [name, role, role2, bio, bio2]; sections [key, title, title2, content, content2].

export const faqs: readonly (readonly (string | number | boolean)[])[] = [
  ["How does a first engagement work?", "প্রথম কাজ কীভাবে শুরু হয়?", "We start with a free 30-minute call, then send a short proposal with scope, timeline and price. Nothing starts until you agree.", "আমরা ৩০ মিনিটের বিনামূল্যে কল দিয়ে শুরু করি, তারপর পরিধি, সময়সূচি ও মূল্যসহ একটি সংক্ষিপ্ত প্রস্তাব পাঠাই। আপনি সম্মত না হওয়া পর্যন্ত কিছুই শুরু হয় না।"],
  ["Do you work with very small businesses?", "আপনারা কি খুব ছোট ব্যবসার সাথে কাজ করেন?", "Yes. Most of our clients have fewer than 20 people, and our packages are sized accordingly.", "হ্যাঁ। আমাদের বেশিরভাগ ক্লায়েন্টের কর্মী সংখ্যা ২০ জনের কম, এবং আমাদের প্যাকেজও সেভাবেই সাজানো।"],
  ["How much does it cost?", "এর খরচ কত?", "Projects start from a fixed fee; ongoing support is billed monthly. You always see the price before we begin.", "প্রকল্প শুরু হয় নির্দিষ্ট ফি থেকে; চলমান সহায়তার বিল মাসিক। কাজ শুরুর আগেই আপনি মূল্য দেখতে পাবেন।"],
  ["Can you work remotely?", "আপনারা কি দূর থেকে কাজ করতে পারেন?", "Yes. We work with clients online and visit on site when it helps.", "হ্যাঁ। আমরা অনলাইনে ক্লায়েন্টদের সাথে কাজ করি এবং প্রয়োজন হলে সরাসরি গিয়ে দেখা করি।"],
  ["How quickly can we start?", "কত দ্রুত আমরা শুরু করতে পারি?", "Usually within two weeks of agreeing the proposal.", "সাধারণত প্রস্তাবে সম্মত হওয়ার দুই সপ্তাহের মধ্যে।"],
];

export const services: readonly (readonly (string | number | boolean)[])[] = [
  ["Business strategy", "ব্যবসায়িক কৌশল", "A clear plan for the next one to three years: goals, priorities and the steps to reach them.", "আগামী এক থেকে তিন বছরের জন্য একটি স্পষ্ট পরিকল্পনা: লক্ষ্য, অগ্রাধিকার এবং সেখানে পৌঁছানোর ধাপসমূহ।"],
  ["Marketing and branding", "মার্কেটিং ও ব্র্যান্ডিং", "Positioning, website and campaigns that bring in the right customers.", "সঠিক গ্রাহক আনার মতো পজিশনিং, ওয়েবসাইট ও ক্যাম্পেইন।"],
  ["Financial planning", "আর্থিক পরিকল্পনা", "Budgets, forecasts and cash-flow reviews so you always know where you stand.", "বাজেট, পূর্বাভাস ও নগদ প্রবাহের পর্যালোচনা, যাতে আপনি সবসময় নিজের অবস্থান জানতে পারেন।"],
  ["Operations review", "কার্যক্রম পর্যালোচনা", "We find the bottlenecks in your processes and fix them with simple, lasting changes.", "আমরা আপনার প্রক্রিয়ার বাধাগুলো খুঁজে বের করি এবং সহজ, স্থায়ী পরিবর্তনের মাধ্যমে সমাধান করি।"],
  ["Team coaching", "টিম কোচিং", "Hiring, onboarding and leadership support for growing teams.", "বেড়ে ওঠা দলের জন্য নিয়োগ, অনবোর্ডিং ও নেতৃত্ব সহায়তা।"],
  ["Digital transformation", "ডিজিটাল রূপান্তর", "Pick and roll out the tools that save time instead of adding work.", "কাজ বাড়ানোর বদলে সময় বাঁচায় এমন টুল বেছে নিন এবং চালু করুন।"],
];

export const plans: readonly (readonly (string | number | boolean)[])[] = [
  ["Starter", "স্টার্টার", 1, "A focused first step.", "একটি মনোযোগী প্রথম ধাপ।", "Initial consultation\nOne written report\nEmail support", "প্রাথমিক পরামর্শ\nএকটি লিখিত প্রতিবেদন\nইমেইল সহায়তা", false],
  ["Standard", "স্ট্যান্ডার্ড", 2, "Our most popular option.", "আমাদের সবচেয়ে জনপ্রিয় বিকল্প।", "Everything in Starter\nMonthly review call\nPriority email support", "স্টার্টারের সবকিছু\nমাসিক পর্যালোচনা কল\nঅগ্রাধিকার ইমেইল সহায়তা", true],
  ["Premium", "প্রিমিয়াম", 4, "Full hands-on support.", "সম্পূর্ণ সরাসরি সহায়তা।", "Everything in Standard\nDedicated consultant\nPhone and on-site support", "স্ট্যান্ডার্ডের সবকিছু\nনির্ধারিত পরামর্শক\nফোন ও সরাসরি উপস্থিত সহায়তা", false],
];

export const testimonials: readonly (readonly (string | number | boolean)[])[] = [
  ["Amelia Carter", "Owner, Carter Bakery", "মালিক, কার্টার বেকারি", "Northwind rebuilt our pricing and our margins improved within a quarter. Honest advice, no jargon.", "নর্থউইন্ড আমাদের মূল্য নির্ধারণ নতুন করে সাজিয়েছে এবং এক প্রান্তিকের মধ্যেই আমাদের মুনাফা বেড়েছে। সৎ পরামর্শ, কোনো জটিল শব্দ নেই।"],
  ["Daniel Okafor", "Director, Okafor Logistics", "পরিচালক, ওকাফোর লজিস্টিকস", "They found three process bottlenecks we had lived with for years. Deliveries are now a day faster.", "তারা এমন তিনটি প্রক্রিয়াগত বাধা খুঁজে পেয়েছে যা নিয়ে আমরা বছরের পর বছর চলছিলাম। এখন ডেলিভারি একদিন দ্রুত হয়।"],
  ["Priya Nair", "Founder, Bloom Studio", "প্রতিষ্ঠাতা, ব্লুম স্টুডিও", "From the first call I felt understood. The new brand and website doubled our enquiries.", "প্রথম কল থেকেই মনে হয়েছে তারা আমাকে বুঝেছে। নতুন ব্র্যান্ড ও ওয়েবসাইট আমাদের জিজ্ঞাসা দ্বিগুণ করেছে।"],
];

export const team: readonly (readonly (string | number | boolean)[])[] = [
  ["Helen Brooks", "Managing Director", "ব্যবস্থাপনা পরিচালক", "Helen founded Northwind after fifteen years leading finance teams. She works with clients on strategy and funding.", "পনেরো বছর অর্থ বিভাগের নেতৃত্ব দেওয়ার পর হেলেন নর্থউইন্ড প্রতিষ্ঠা করেন। তিনি ক্লায়েন্টদের সাথে কৌশল ও অর্থায়ন নিয়ে কাজ করেন।"],
  ["Marcus Lee", "Head of Operations", "অপারেশনস প্রধান", "Marcus turns plans into routines that work every day, from small shops to multi-site teams.", "মার্কাস পরিকল্পনাকে প্রতিদিনের কার্যকর রুটিনে রূপ দেন, ছোট দোকান থেকে বহু-শাখার দল পর্যন্ত।"],
  ["Sofia Alvarez", "Marketing Lead", "মার্কেটিং প্রধান", "Sofia shapes brands and campaigns with a focus on measurable results.", "সোফিয়া পরিমাপযোগ্য ফলাফলের দিকে লক্ষ্য রেখে ব্র্যান্ড ও ক্যাম্পেইন গড়ে তোলেন।"],
  ["Tom Whitfield", "Senior Consultant", "জ্যেষ্ঠ পরামর্শক", "Tom coaches owners and managers through growth, hiring and change.", "টম মালিক ও ম্যানেজারদের প্রবৃদ্ধি, নিয়োগ ও পরিবর্তনের পথে কোচিং দেন।"],
];

export const sections: readonly (readonly (string | number | boolean)[])[] = [
  ["hero", "Grow with confidence", "আত্মবিশ্বাসের সাথে এগিয়ে যান", "We help local businesses plan, launch and scale with clear, honest guidance and hands-on support.", "স্থানীয় ব্যবসাকে পরিকল্পনা, শুরু এবং প্রসারে আমরা সহায়তা করি স্পষ্ট ও সৎ দিকনির্দেশনা এবং সরাসরি সহযোগিতার মাধ্যমে।"],
  ["about", "About us", "আমাদের সম্পর্কে", "Northwind started in 2012 with a simple idea: small businesses deserve the same quality of advice as large ones.\n\nToday our team of specialists supports more than 300 clients across retail, hospitality and professional services.", "নর্থউইন্ড ২০১২ সালে একটি সহজ ধারণা নিয়ে শুরু হয়েছিল: বড় প্রতিষ্ঠানের মতো ছোট ব্যবসাও সমান মানের পরামর্শ পাওয়ার যোগ্য।\n\nআজ আমাদের বিশেষজ্ঞ দল খুচরা, আতিথেয়তা ও পেশাদার সেবা খাতের ৩০০-র বেশি ক্লায়েন্টকে সহায়তা করছে।"],
  ["services", "Our services", "আমাদের সেবা", "From strategy to day-to-day delivery, here is how we can help.", "কৌশল থেকে দৈনন্দিন বাস্তবায়ন পর্যন্ত, আমরা যেভাবে সহায়তা করতে পারি।"],
  ["pricing", "Our pricing", "আমাদের মূল্য তালিকা", "Clear, upfront prices for every service.", "প্রতিটি সেবার জন্য স্পষ্ট ও আগেভাগে জানা মূল্য।"],
  ["testimonials", "What clients say", "ক্লায়েন্টরা যা বলেন", "Real feedback from the people we work with.", "আমাদের সাথে কাজ করা মানুষদের প্রকৃত মতামত।"],
  ["gallery", "Gallery", "গ্যালারি", "A look at our work and our workspace.", "আমাদের কাজ এবং কর্মস্থলের একটি ঝলক।"],
  ["faq", "Frequently asked questions", "সচরাচর জিজ্ঞাসা", "Quick answers to the things we are asked most.", "আমাদের সবচেয়ে বেশি করা প্রশ্নগুলোর দ্রুত উত্তর।"],
  ["team", "Meet the team", "আমাদের দলের সাথে পরিচিত হন", "The people behind your results.", "আপনার সাফল্যের পেছনের মানুষগুলো।"],
  ["contact", "Get in touch", "যোগাযোগ করুন", "Tell us about your project and we will reply within one working day.", "আপনার প্রকল্প সম্পর্কে আমাদের জানান, আমরা এক কার্যদিবসের মধ্যে উত্তর দেব।"],
];

