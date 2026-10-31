import openpyxl
from openpyxl.styles import Font, PatternFill

SRC = "/Users/applestore/Desktop/emailtemplatesandleads/Email Marketing sheet.xlsx"
OUT = "/Users/applestore/.gemini/antigravity-ide/scratch/zoho_outreach_automation/Outreach_Workbook.xlsx"

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Leads"
head = ["Name", "Email", "Location", "Company", "Website", "Title", "LinkedIn URL", "Notes",
        "Status", "Reply Status", "Last Step", "Follow-ups Sent", "Date Sent", "Last Sent At",
        "Due At", "Replied At", "Reply Snippet", "Message ID", "Time Zone"]
ws.append(head)
for c in ws[1]:
    c.font = Font(bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor="1F3864")
ws.freeze_panes = "C2"

st = wb.create_sheet("Settings")
rows = [
    ("Paused", "TRUE"),
    ("Sender Name", "Sohail Anwar"),
    ("Zoho Address", "yourname@sourcepivot.co"),
    ("Zoho Data Center", "com"),
    ("Test Email", "FILL_ME"),
    ("Alert Email", "FILL_ME"),
    ("Follow-up Delays (hours)", "24,48,168,168"),
    ("Send Window Start (local hour)", 8),
    ("Send Window End (local hour)", 11),
    ("Min Gap (minutes)", 3),
    ("Max Gap (minutes)", 14),
    ("Daily Send Cap (rolling 24h)", 150),
]
for r in rows:
    st.append(r)
st.column_dimensions["A"].width = 34
st.column_dimensions["B"].width = 34

tp = wb.create_sheet("Templates")
tp.append(["Step", "Subject", "Body"])
tp.append([0, "{Request for Meeting|Quick introduction|Potential collaboration}",
"""{Hi|Hello} {{FirstName}},

I'm reaching out to explore a potential collaboration with {{CompanyName}}.

We support research teams with B2B recruitment and fieldwork across APAC, EMEA, and the Americas, particularly for niche and hard-to-reach audiences.

If {{CompanyName}} has any upcoming projects where additional recruitment or fieldwork support could be useful, I'd be happy to explore how we can help.

Would you be open to a quick 15-minute call next week?

{Regards|Best regards|Kind regards},
Sohail Anwar
Source Pivot"""])
tp.append([1, "Re: Request for Meeting",
"""{Hi|Hello} {{FirstName}},

{Just following up on my previous note.|Just circling back on my earlier message.|Wanted to quickly follow up on my last note.}

Would you be available for a quick introductory call?

{Looking forward to hearing from you.|Happy to work around your schedule.}

{Regards|Best regards},
Sohail Anwar
Source Pivot"""])
tp.append([2, "Re: Request for Meeting",
"""{Hello|Hi} {{FirstName}},

I wanted to check back in case additional recruitment or fieldwork support is relevant to any projects currently in your pipeline.

We can help source niche professional audiences and provide fieldwork support across multiple markets, depending on your project needs.

If there's a brief you're able to share, I'd be glad to review it and provide an initial feasibility assessment.

{Regards|Best regards},
Sohail Anwar
Source Pivot"""])
tp.append([3, "Re: Request for Meeting",
"""{Hello|Hi} {{FirstName}},

I know priorities and project timelines can shift, so I wanted to reach out {one last time|once more}.

If your team needs additional support reaching hard-to-find professionals or managing fieldwork for an upcoming study, Source Pivot would be glad to be considered.

Feel free to keep my details on hand, and reach out whenever a suitable requirement comes up.

{Regards|Best regards},
Sohail Anwar
Source Pivot"""])
tp.append([4, "Re: Request for Meeting",
"""{Hello|Hi} {{FirstName}},

{Just a final check-in from my side.|Just one more note from my side.}

Would you be available for a quick introductory call? If now isn't the right time, no problem at all.

{Looking forward to hearing from you.|Thanks for your time.}

{Regards|Best regards},
Sohail Anwar
Source Pivot"""])
tp.column_dimensions["B"].width = 40
tp.column_dimensions["C"].width = 100

lg = wb.create_sheet("Log")
lg.append(["Time", "Type", "Email", "Details"])
wb.save(OUT)
print("leads:", ws.max_row - 1)
