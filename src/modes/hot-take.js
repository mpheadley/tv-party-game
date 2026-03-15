/**
 * Hot Take Mode Handler
 * Text-based prompts, players submit text answers
 */

const PROMPTS = [
  // Classic silly
  "What's the worst name for a pet goldfish?",
  "What would a dog's first text message say?",
  "Invent a holiday that should exist but doesn't.",
  "What's the worst superpower to have at school?",
  "Name a new ice cream flavor nobody asked for.",
  "Write a one-star review of the ocean.",
  "If animals could talk, which one would be the rudest?",
  "What's the worst thing to say on a roller coaster?",
  "Invent a sport that would never make the Olympics.",
  "Name a breakfast cereal for villains.",
  "What's the most useless app idea?",
  "If you could rename any planet, what would you call it?",
  "Name a rejected crayon color.",
  "What's the worst name for a band made of grandparents?",
  "Write a one-star review of gravity.",
  "What's the worst flavor of toothpaste?",
  "Name a movie sequel nobody wants.",
  "What's the worst thing to yell in a library?",
  "Name a terrible video game power-up.",
  "What's the worst excuse for not doing chores?",
  "What would aliens say about Earth after visiting?",
  "What's the worst thing to put on a sandwich?",
  "Name a terrible name for a superhero.",
  "What's the funniest thing to find inside a treasure chest?",
  "Name a video game that would be impossible to win.",

  // Social media / internet age
  "What would a penguin's TikTok bio say?",
  "Write the most unhinged Google search in your history.",
  "What's the worst WiFi password?",
  "Name a YouTube channel that would get zero subscribers.",
  "What's the worst group chat name?",
  "Write the most suspicious text to accidentally send your teacher.",
  "What notification would ruin your day?",
  "Describe a social media influencer for ants.",
  "What's the worst thing to go viral for?",
  "Write a one-star review of sleep.",

  // School / teen life
  "What's something you'd never want your teacher to find out?",
  "What's the worst excuse for being late to class?",
  "Describe the worst school field trip destination.",
  "What's the most suspicious thing to have in your locker?",
  "Write a text that would get you grounded instantly.",
  "What's the worst thing to whisper to the person next to you during a test?",
  "Invent a new school rule that would cause chaos.",
  "What's the worst yearbook quote?",

  // Absurd / creative
  "If your refrigerator could talk, what secret would it expose?",
  "What would a fish think about all day?",
  "If socks could talk, what would they complain about?",
  "Describe a useless invention by a lazy genius.",
  "What would a cloud write in its diary?",
  "What would a talking pizza say right before being eaten?",
  "Write a complaint letter from a snowman to the sun.",
  "What would happen if dogs could drive cars?",
  "If you had a pet dragon, what would go wrong first?",
  "Write a fortune cookie message that makes no sense.",
  "What would a robot say on its first day of school?",

  // Spicy (still family-safe but funnier for teens)
  "What's the worst dating advice you could give?",
  "What's the most embarrassing thing to have fall out of your backpack?",
  "Describe the worst possible first impression.",
  "What would your browser history say about you in court?",
  "What's the worst thing to say during an awkward silence?",
  "Write a terrible motivational poster for a gym.",
  "What's the worst thing to accidentally say on a hot mic?",
  "Name a candle scent that would sell zero units.",
  "What would your pet say about you behind your back?",
  "What's the worst thing to put on a resume?",

  // Snarky / roast / unhinged (family-safe for ages 9-16)
  "What's the real reason your parents had a second kid?",
  "Write a passive-aggressive sticky note from your fridge.",
  "What's your screen time report ACTUALLY hiding?",
  "Describe your sibling using only a warning label.",
  "What would Gordon Ramsay say about your cooking?",
  "Write a Yelp review of your family's Thanksgiving.",
  "What's the group chat message that would end a friendship?",
  "Your last brain cell is writing a resignation letter. What does it say?",
  "Describe your morning routine like a nature documentary narrator.",
  "What would your search history say during a job interview?",
  "Write a brutally honest college application essay in one sentence.",
  "What's the most unhinged thing you've done when nobody was watching?",
  "Your WiFi goes out for 24 hours. Write your diary entry.",
  "Describe your family using only red flags.",
  "What would your teacher's Yelp review of you say?",
  "Write a product recall notice for yourself.",
  "Your conscience is leaving a one-star review. What does it say?",
  "What lie are you STILL committed to?",
  "Roast your best friend using only compliments.",
  "What would a documentary about your life be called?",
  "Your phone is writing a tell-all memoir. What's the first chapter?",
  "Describe your sleep schedule to a concerned doctor.",
  "What's the most chaotic thing in your camera roll right now?",
  "Write an apology letter from your homework to your teacher.",
  "What would your pet's restraining order against you say?",
  "Describe your personality as a candle scent nobody would buy.",
  "What's the most suspicious thing you could whisper to a stranger?",
  "Your stomach just started a podcast. What's episode one about?",
  "Write a formal complaint about someone in this room WITHOUT naming them.",
  "What would the FBI agent watching your screen write in their report?",

  // 2025-2026 brainrot / chronically online
  "This answer is giving delulu. Write your most unhinged hot take.",
  "You're the main character today. What's your villain origin story?",
  "That's cap. What's the biggest lie you've ever gotten away with?",
  "Drop your most 'no thoughts, just vibes' moment.",
  "You just got the ick. What happened?",
  "Your rizz level is zero. Write your worst pickup line.",
  "Write something that would make everyone say 'bro cooked too hard.'",
  "POV: you're explaining your screen time to a therapist. What do you say?",
  "You're in your flop era. Describe it.",
  "Write something so unhinged it lives rent-free in everyone's head.",
  "Name something that's lowkey a red flag but you do it anyway.",
  "What's the most NPC thing you've ever done?",
  "You've been put on blast. What for?",
  "Write a text that radiates 'I woke up and chose chaos' energy.",
  "What would your Roman Empire be? (The thing you think about constantly.)",
  "Rate your family's group chat out of 10 and explain.",
  "What's the most 'slay' thing you've ever done? Be honest.",
  "You're a side quest NPC. What mission do you give people?",
  "Write a BeReal caption for your most embarrassing moment.",
  "What's your biggest 'it's giving...' moment?",

  // Expanded: Food & Cooking
  "What would be the worst food combination to serve at Thanksgiving?",
  "Name a energy drink flavor that should never exist.",
  "Write a one-star review of your school's cafeteria.",
  "What's the worst cereal mascot you could invent?",
  "Describe your cooking skill using only ingredients.",
  "What would a sentient pickle say to another pickle?",

  // Expanded: Fashion & Appearance
  "Design the most ridiculous outfit for gym class.",
  "What's the worst fashion trend of all time?",
  "Describe your personal style if you had zero taste.",
  "Name a shoe brand that would go bankrupt immediately.",
  "What's the most cursed hairstyle ever attempted?",

  // Expanded: Technology & Gaming
  "What would a very confused AI write as homework?",
  "Design the worst video game controller imaginable.",
  "What's the worst tech support advice you could give?",
  "Write an angry review of your own phone.",
  "What would a glitchy video game character say?",
  "Name a completely useless tech gadget.",

  // Expanded: Movies & Entertainment
  "What's the worst movie title you could think of?",
  "Write a trailer for a movie that should not exist.",
  "What would a villain's Rotten Tomatoes review say?",
  "Design the worst plot twist ever.",
  "Name an actor as a villain doing their daily job.",

  // Expanded: Sports & Competitions
  "What's the most ridiculous Olympic sport idea?",
  "Write championship commentary for people eating lunch.",
  "What would esports look like if it were a real sport?",
  "Name a sport that combines two terrible combinations.",
  "What's the worst team mascot possible?",

  // Expanded: Travel & Adventure
  "Write a travel review of the worst vacation spot.",
  "What would a lost tourist write in a TripAdvisor review?",
  "Design the worst cruise ship activity ever.",
  "Name a destination nobody would ever want to visit.",
  "What's the most chaotic road trip that could happen?",

  // Expanded: Animals & Nature
  "If a squirrel wrote a yelp review of a tree.",
  "What would a confused bird think about buildings?",
  "Write a nature documentary about household pests.",
  "What's the weirdest animal superpower?",
  "Describe your pet as if it had a criminal record.",

  // Expanded: Relationships & Social
  "What would your enemy's wedding toast say?",
  "Write the worst pickup line from an alien.",
  "What's the most awkward thing to do at a party?",
  "Describe your crush like you're writing a court report.",
  "Write the worst apology text possible.",

  // Expanded: Hypotheticals & Scenarios
  "If you were a sandwich, what would you be?",
  "What's the worst supermarket you could shop at?",
  "Write a will for your left sock.",
  "If trash talked, what would it say?",
  "Design the worst house ever built.",

  // Expanded: School & Learning
  "Write the worst college application essay ever.",
  "What would your report card say if it was honest?",
  "Design a completely useless school subject.",
  "What's the worst homework excuse that's actually true?",
  "Write a love letter from a student to sleep.",

  // Expanded: Trending Vibes
  "What's the most 'random and quirky' thing you could do?",
  "Write in the most overused slang voice possible.",
  "What would a drama starter's apology note say?",
  "Describe yourself as a flavor of gatorade.",
  "What's your most 'main character moment' that flopped?",
];

/**
 * Pick a prompt for Hot Take
 * Filters out already-used prompts, cycles when all used
 */
function pickPrompt(game, customPrompts = []) {
  // Merge default + custom prompts
  const allPrompts = [...PROMPTS, ...customPrompts];
  const available = allPrompts.filter(p => !game.usedPrompts.includes(p));

  // Cycle if all used
  if (available.length === 0) {
    game.usedPrompts = [];
  }

  const pool = available.length > 0 ? available : allPrompts;
  const prompt = pool[Math.floor(Math.random() * pool.length)];
  game.usedPrompts.push(prompt);
  return prompt;
}

/**
 * Validate answer text for Hot Take
 */
function validateAnswer(text) {
  const cleanText = String(text).trim().slice(0, 200);
  return cleanText.length > 0 ? cleanText : null;
}

module.exports = {
  PROMPTS,
  pickPrompt,
  validateAnswer,
};
