// Folio settings. Edit this file, not index.html.
// 1. Paste your four Firebase values between the quotes.
export const FIREBASE_CONFIG = { apiKey:'AIzaSyDzYjHKZnTJjNXzaDySKpCoJB1OwnInKFQ', authDomain:'folio-af0ce.firebaseapp.com', projectId:'folio-af0ce', appId:'1:819292250837:web:850fc1d924e6c2c3be785c' };

// 2. ALLOWED_DOMAIN: only accounts ending in this domain are accepted.
//    CAP: most tasks per day across all classes.
//    EMAIL_LOGIN: false = Google sign-in only (recommended). true = also allow email + password.
export const CONFIG = { ALLOWED_DOMAIN:'imsa.edu', CAP:3, EMAIL_LOGIN:false };

// 3. Your classes. Keep each id short, lowercase, no spaces. Teachers are matched to a class by id.
export const CLASSES = [
 {id:'calc',name:'Literary Explorations III: World',teacher:'Dr. Hancock'},
  {id:'chem',name:'Biology: Molecular and Cellular',teacher:'Dr. Amacher'},
  {id:'lit',name:'Mathematical Investigations II',teacher:'Dr. Krouse'},
  {id:'cs',name:'Foundations of Healthy Living',teacher:'Ms. Myers and Mr. Lundgren'},
  {id:'hist',name:'Spanish III',teacher:'Profe Kaluza'}

];
