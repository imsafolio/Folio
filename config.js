// Folio settings. Edit this file, not index.html.
// 1. Paste your four Firebase values between the quotes.
export const FIREBASE_CONFIG = { apiKey:'AIzaSyDzYjHKZnTJjNXzaDySKpCoJB1OwnInKFQ', authDomain:'folio-af0ce.firebaseapp.com', projectId:'folio-af0ce', appId:'1:819292250837:web:850fc1d924e6c2c3be785c' };

// 2. ALLOWED_DOMAIN: only accounts ending in this domain are accepted.
//    CAP: suggested max HEAVY items per day (tests, quizzes, red) for the same students. Teachers can go over it after confirming.
//    EMAIL_LOGIN: false = Google sign-in only (recommended). true = also allow email + password.
export const CONFIG = { ALLOWED_DOMAIN:'imsa.edu', CAP:3, EMAIL_LOGIN:false };

// 3. Your classes. Keep each id short, lowercase, no spaces. Teachers are matched to a class by id.
//    grades: which grade levels take the class (10 = sophomores, 11 = juniors, 12 = seniors).
//    A class with no grades list is counted for everyone.
export const CLASSES = [
 {id:'eng',name:'Literary Explorations III: World',teacher:'Dr. Hancock',grades:[10]},
  {id:'bio',name:'Biology: Molecular and Cellular',teacher:'Dr. Amacher',grades:[10]},
  {id:'math',name:'Mathematical Investigations II',teacher:'Dr. Krouse',grades:[10]},
  {id:'cs',name:'Computer Science Inquiry',teacher:'Dr. Mohan',grades:[10]},
  {id:'lang',name:'Spanish III',teacher:'Profe Kaluza',grades:[10]}

];
