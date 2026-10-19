# מערכת משוב חדר אוכל – LEE BAR

| מה | קישור | למי |
|---|---|---|
| סקר לטאבלט | `indexF.html?station=<קוד>` | הטאבלט בכניסה. רק מילוי סקר, אין ממנו גישה לדשבורד |
| דשבורד | `dashboard.html` | מנהלים ראשיים רואים את כל התחנות, מנהל תחנה רואה רק את התחנות שלו |

הנתונים נשמרים ברשימות SharePoint באתר **leebar** של לי-בר. הכניסה היא עם חשבונות Microsoft של החברה, וההרשאות נאכפות על ידי SharePoint.

- טאבלט נתב"ג: https://yarinifrah12.github.io/Leebar-Feedback/indexF.html?station=natbag
- דשבורד: https://yarinifrah12.github.io/Leebar-Feedback/dashboard.html

---

## הקמה

### 1. רישום האפליקציה ב-Entra (בוצע: LEE BAR Feedback)
- **Authentication ← Single-page application**: שתי הכתובות שלמעלה, בלי `?station=...`
- **API permissions ← Microsoft Graph ← Delegated**: `User.Read`, `Sites.ReadWrite.All`, `Sites.Manage.All`
- **Grant admin consent**

### 2. הקמת הרשימות (פעם אחת, לחיצה אחת)
פותחים את הדשבורד ונכנסים עם חשבון שיש לו הרשאת עריכה באתר leebar ← **"הקמת הרשימות ב-SharePoint"**.
נוצרות 4 רשימות: `LBFeedbackResponses`, `LBFeedbackStations`, `LBFeedbackRecipients`, `LBFeedbackSettings`. מי שהקים אותן הופך למנהל/ת ראשי/ת.

### 3. משתמש לטאבלטים (מנהל המערכת)
1. יוצרים משתמש, למשל `tablet@leebar.co.il`, עם רישיון שכולל SharePoint (למשל Business Basic).
2. **ברשימה LBFeedbackStations**: הרשאת **Read** למשתמש הטאבלט.
3. **ברשימה LBFeedbackResponses**:
   - List settings ← Permissions for this list ← Stop inheriting ← להוסיף את משתמש הטאבלט עם **Contribute**.
   - List settings ← Advanced settings ← Item-level permissions:
     - Read access: **Read items that were created by the user**
     - Create and Edit access: **Create items and edit items that were created by the user**
   - כך הטאבלט יכול רק להוסיף משובים, ולא יכול לראות משובים אחרים.
4. **מנהלים** (מנכ"ל, מנהלי תחנות) צריכים הרשאת **Read** לכל הרשימות. מי שמנהל את ההגדרות צריך **Edit**.

### 4. חיבור טאבלט
פותחים את קישור התחנה ← "התחברות עם Microsoft" עם משתמש הטאבלט ← בוחרים תחנה ← מזינים את קוד הטאבלט (2 האותיות הראשונות של שם התחנה, לנתב"ג: **כו**).
להחלפת תחנה: לוחצים 3 שניות על שם התחנה בפינה הימנית התחתונה.
מומלץ לנעול את הטאבלט על הדפדפן במסך מלא (Guided Access / הצמדת מסך).

---

## ניהול (בדשבורד, מנהלים ראשיים בלבד)
- **תחנה חדשה:** שם + מייל מנהל התחנה ← "הוספת תחנה". אחר כך "העתקת קישור לטאבלט".
- **מנהלי תחנה:** מיילים מופרדים בפסיק ליד כל תחנה.
- **מנהלים ראשיים:** רשימת מיילים שרואים את כל התחנות ואת ההגדרות.
- **נמעני דוח יומי:** שעה, מייל ותחנות לכל נמען. נשמר ברשימה `LBFeedbackRecipients`.

## דוח יומי במייל (שלב הבא)
תהליך Power Automate עם מחברים סטנדרטיים, בלי Premium: Recurrence (כל שעה) ← Get items מ-`LBFeedbackRecipients` ← לכל נמען שהשעה שלו הגיעה: Get items מ-`LBFeedbackResponses` של אתמול לתחנות שלו ← Send an email (V2).
