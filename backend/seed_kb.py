from dotenv import load_dotenv
load_dotenv()
from extra import sb, embed

ARTICLES = [
    ("Cannot connect to office WiFi",
     "Symptoms: laptop shows no internet or cannot see the office network.\n"
     "1. Turn Wi-Fi off and on, or toggle airplane mode.\n"
     "2. Select the office network, choose Forget, then reconnect.\n"
     "3. Restart the computer.\n"
     "4. If other devices connect fine, escalate to the network team.", "network"),
    ("Forgot password or account locked",
     "Symptoms: login fails or says the account is locked.\n"
     "1. Wait 15 minutes, since lockouts clear automatically.\n"
     "2. Use the Forgot password link on the sign-in page.\n"
     "3. If you get no reset email, create a ticket for the accounts team.", "accounts"),
    ("Printer not printing",
     "Symptoms: jobs stay in the queue or the printer shows offline.\n"
     "1. Check the printer is on and has paper.\n"
     "2. Cancel stuck jobs in the print queue.\n"
     "3. Restart the printer, then print a test page.\n"
     "4. If still offline, create a ticket for the hardware team.", "hardware"),
]
for title, body, cat in ARTICLES:
    sb.table("kb_articles").insert(
        {"title": title, "body": body, "category": cat, "embedding": embed(f"{title}\n{body}")}
    ).execute()
    print("added:", title)