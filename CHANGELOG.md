# Changelog

**What this file is:** the product history of OfferOS, written for someone who
does not work on it. Each entry says what was wrong, what was done about it, and
what actually changed as a result — stated in terms you could check yourself
rather than in adjectives.

Entries are grouped by the day the work landed, newest first, with
[Keep a Changelog](https://keepachangelog.com/) categories inside each day.
Versions will follow [Semantic Versioning](https://semver.org/) once there is
something to version.

OfferOS is pre-alpha and has never been released. Everything below is under
**Unreleased** and describes what exists on `main`. There are no upgrade paths
to honour yet and no published builds — expect the shape of things to move.
Notable changes only; not every commit is an entry.

## [Unreleased]

---

## 2026-08-12

### Fixed

**The Fill button no longer goes dead with fields still to fill.** After a round
that left some fields unwritten, the button greyed out while its own label went
on counting them — "Fill 3 fields", unclickable, with three empty boxes on the
page. It now stays live and reads "Fill 3 remaining", and pressing it retries
only what did not land the first time; fields already written and checked are
left alone.

**A dropdown that is really a text box now gets typed into.** Some forms declare
a control as a dropdown when there is no list behind it — a postal code field
was one — and every attempt to open the list failed, so the city, state and
postal code were handed back to the user with their values sitting ready. When
no list appears, OfferOS now looks for a box underneath that a person could type
into, types the value, and reads it back to confirm the page kept it. It says so
on the field, so you know that one arrived by a route worth glancing at. A
genuine dropdown that ignores the click still says so plainly rather than
pretending.

**A failed analysis request is retried once before you hear about it.** The
first request after the server has been idle could come back an error and then
work seconds later. OfferOS now asks again after a couple of seconds and only
reports a failure if that fails too — in plain words. Only reads are retried;
nothing that writes to your application is ever sent twice on its own.

**Equal Employment answers have one place to manage them.** They were listed
both in their own section and again in the general Answers list — same storage,
shown twice — so deleting the apparent duplicates destroyed the real answers,
while the section above went on displaying them as if they were still set. The
Answers list no longer shows them and says where they live; both views now share
one set of data, so a change in either shows in both immediately; and each
Equal Employment row states whether an answer is actually stored ("Saved" or
"Not set") rather than acknowledging your last click.

**Saving an answer updates the existing one instead of adding a second.** Every
place that saves an answer — the profile page, the Equal Employment section, the
panel accepting one mid-application — now updates the entry for that question if
there is one. Two entries for the same question meant the form got whichever was
found first. Changes to your saved answers are also recorded now, so a deletion
leaves a trace.

**Backups fold the database log back in first.** A database left running for
days can accumulate a large write-ahead log that nothing collects; on one
machine a 1 MB database had grown a 4 MB log. Exporting a backup, and opening
the database, now collect it. Backups were always complete — this is about the
disk the log was holding.

---

## 2026-08-20

### Added

**The fields OfferOS cannot fill can be handed to the agent.** Until now the
fallback for an unrecognised field was a narrow one: a model was asked which
standard field it looked like, and was shown nothing at all about you. That can
recognise "Telefonnummer" and can do nothing with "which of your projects is
most relevant to this role?" — a question you answer by having read your own
résumé and the posting. The agent now gets both, along with your profile and the
answers you have saved before, and works through what is left in one pass.

**Every suggestion arrives with its source and its reason,** and none of them is
written for you. You see the value, a line saying where it came from — your
profile, your résumé, the job description, an answer you saved — and you apply
them one at a time or all at once. A value you apply is recorded as the agent's,
with that reason, so the record of the application says how each answer got
there.

**An answer that cannot be traced back to your own material is thrown away
before you see it.** The agent has to quote the words its answer rests on, and
OfferOS checks that quote is genuinely in the source named. This is what stops a
plausible invention — a job you never held, a date that was never true — from
reaching an employer's form. It is a check, not an instruction.

**Long answers can be drafted one at a time,** with a word from you about what
to emphasise: "lead with the Docker work". Your instruction is treated as yours,
not as text scraped off the page.

**Identity, work authorisation and consent questions are never answered for
you** — the panel says plainly that they are yours, and offers no AI button at
all.

## 2026-08-19

### Fixed

**Your work history fills in as your work history.** Forms that ask for several
jobs or several schools were getting the same answer in every row — three
employers came out as one company three times, and each row's description was
written by AI instead of taken from what you had already written about that job.
Each row now gets its own entry, in order, and a row's summary is your own words
about that role. Nothing is generated where the real answer was already on file.

**Those sections also open themselves.** Many forms start education and work
history as an empty table with an "Add" button, so there was nothing to fill
until you found the button and pressed it once per entry. How many rows you need
is something OfferOS can already see — two schools means two rows.

**"Years of experience" answers itself.** The question is asked constantly and
was coming back blank while the answer sat in your profile as a list of dates.
It is worked out from those: whole years, rounded down, and overlapping roles
counted once. When the dates cannot support a number, it stays blank rather than
guessing.

**A job description that was mostly the form talking about itself.** Capturing a
posting from a page that also holds its application form was picking up the
form's own words — a country dropdown's two hundred country names, an upload
widget's "Drag and drop or browse / Max 5 MB / PDF, DOC, DOCX". On one capture
more than half the stored description was that. Controls and their chrome are
now left out; the posting's headings and lists are kept.

**Three re-fills no longer leave three copies of your résumé.** Nothing checked
whether the file was already on the form, so every fill attached it again. It is
now left alone when it is already there — and said so, rather than reported as a
fresh upload.

**Fields inside a labelled section stopped borrowing the section's name.** Every
input inside a group called "Educational Details" was being labelled
"Educational Details".

## 2026-08-20

### Added

**A Documents page, holding every document.** Three kinds of the same thing were
kept in three unrelated places: what OfferOS wrote for a job lived inside that
job's workspace, the résumés you uploaded were a section of your Profile, and the
cover-letter templates had a page of their own. They are now one page with three
tabs — Generated, Base résumés, Templates — and the top nav is back to five
items. The Generated tab is new work rather than a move: it lists every tailored
résumé and cover letter across every application, with the job it belongs to, how
many versions it has, whether it is still a draft or was accepted, and links to
the workbench and the PDF. Deleting one is possible from there, and deleting a
tailored résumé says what that does to the next form fill before you confirm it.

**Generated documents have names.** They had none — a tailored résumé was an
untitled thing inside an application, and its PDF arrived on your disk named
after whatever the download code assembled at the time. Each is now named when it
is written (resume_Acme_2026-08-12, cover_Acme_2026-08-12), can be renamed, and
the download uses that name. Documents generated before this reads with the same
default name they would have been given, so nothing needed converting.

**The assistant can see all your documents at once.** Every question it could
answer about documents was about the job in front of it, so "which résumés have I
generated" or "where is that letter for Databricks" had nothing behind them. It
can now read the whole list.

### Fixed

**A download whose name was not in the Latin alphabet lost its filename — and
its attachment.** A company written in Chinese produced a header the browser
rejected outright, so the file arrived unnamed instead of just untranslated. The
name is now carried in the field made for it.

### Changed

**Where the résumé files live.** They moved from the Profile page to Documents.
Profile is who you are; a file you uploaded is an asset. First-run setup is
unchanged — it still takes your résumé and builds the profile from it. The old
/templates address redirects to its new home.

---

## 2026-08-19

### Fixed

**The assistant told a user it had not done something it had just done.** Asked
to fine-tune a résumé that did not exist yet, it generated one — and then
answered that there was nothing to fine-tune and offered to generate it. The
answer was written from a flat list of everything the turn had learned, where a
failure from before the work sits next to the work itself; it believed the
failure. What a turn CHANGED is now stated separately from what it read, and
stated as fact: the answer has to report it. Generating a document costs money,
so leaving it out of the reply is not one of the options.

**A refusal that told the assistant nothing.** Tools that work on one
application used to fail with "this tool needs a task" when the conversation had
not settled on a job — no class, no way out — and the assistant retried them
until it ran out of turn. They now refuse the way everything else in OfferOS
refuses: with the reason and the fix (find the application first, or ask which
one is meant).

### Changed

**A clear request gets done, not questioned.** "Change my résumé" when there is
no draft yet means write the first one; that is the first step of the change,
not a different request. The assistant now acts when the intent is clear, and
saves its questions for real forks — several jobs it could be, or something only
you know.

**A finished chat turn reads as what came of it.** The fold under an answer used
to say "6 steps · 1 did · 3 failed"; it now leads with the outcome ("Generated a
tailored résumé") and keeps the tally inside, for when you want to see exactly
what ran. A document the assistant produced links straight to that document's
workbench instead of the application page. And "Stopped at the step limit"
appears only when the turn produced nothing — printed above a résumé it had just
written, it was apologising for the work.

---

## 2026-08-18

### Fixed

**"23/73 required fields filled" was not about required fields.** The progress
line on an application counted every field OfferOS filled over every control it
met — including the ones it had correctly left alone. On a real application that
read 23 of 73 when the truth was 17 of 24. The numbers now count what the
sentence says they count.

**A job description that was one sentence long.** Some postings are written by
JavaScript, so a server fetching them sees only the blurb meant for link
previews. That blurb was outranking the real page text and being stored as the
description. It is now ranked below anything fuller, a one-line tagline does not
qualify at all, and where it genuinely is all a server can see, the card says so
instead of presenting it as the posting.

**The résumé upload that could not be seen.** Forms that style their own upload
button hide the real file input underneath. OfferOS skipped it for being
invisible, so there was nothing to attach to and the résumé was silently never
uploaded. File inputs are now read even when hidden — they are the one control
routinely hidden on purpose — and the attach finds the real one behind a custom
button.

**Fields labelled `value`.** When a page gives a field no label, OfferOS falls
back to whatever the page calls it internally, and some pages call everything
something generic. Several different questions were arriving named "value". A
label that fits every field names none, so those now count as no label and the
field goes to the AI reader with its surrounding text.

### Added

**Education and work history sections open themselves.** Plenty of forms start
these as an empty table with an "Add" button — the rows do not exist until
something presses it, so there was nothing to fill and nothing to show. OfferOS
can now open them, stopping at whatever limit the page states and saying so
honestly when a press produces no row.

**The description can be read from the page you are looking at.** When a posting
only exists once a browser has drawn it, the panel can now send what it sees to
OfferOS, replacing a description that came back as a fragment.

**The AI reader is always one press away.** It used to appear only when a form
had gone badly wrong, which meant that on a form OfferOS mostly understood, the
two or three fields that most needed a second opinion could not reach it. It now
sits on the fill card with the number of fields it would actually look at.

## 2026-08-17

### Fixed

**Forms whose fields have no id at all can now be read.** Some form builders
leave the visible box with an empty id and keep the field's identity somewhere
else entirely, so every way of matching a label to a field had nothing to match
on. OfferOS now follows the identity wherever the page keeps it, reads a label
carried as a component's own property, and looks one level further up the page
for the row a field sits in. It also stops reading the hidden second copy of the
form that these builders leave behind — which was being listed as a duplicate
set of questions, and was winning the argument about what each field is called.

**A job description made of JavaScript.** Reading a page's text picked up the
source of every script on it, and on a modern careers page that is most of the
bytes. Descriptions captured that way were stored, shown, and sent to the AI
reader as though the employer had written them. Page text is now read the way a
person sees it, with scripts, styles and hidden templates left out.

**A description that came out wrong can be fixed.** Fetching a posting only ever
filled an empty description, so a record already holding the wrong text could
not be repaired from the page — every fetch saw something there and left it. A
fetch you press may now replace what is stored, and what it replaced is recorded
on the timeline in case the new one is worse. Automatic checks still never
overwrite anything.

**And a bad description is pointed out rather than left to be discovered.** When
a stored description reads like page code instead of a posting, the page says so
and offers to fetch it again or let you paste it yourself.

**Long unbroken text no longer stretches the page.** A minified script or a very
long link has no spaces to wrap at, and was pushing the description, the field
report and the requirements list past the edge of their cards.

## 2026-08-16

### Fixed

**Forms that never label their fields can now be read.** Plenty of application
forms put the question right next to the box and connect the two with nothing at
all — no `for`, no wrapping, nothing a browser would call a label. OfferOS used
to take the first text it could find near such a field, which on those forms is
the field's internal name. The panel would list your questions as
`rec-form_682152000000063542` and `-None-`, and the AI reader, handed those,
correctly said it could not place a single one. It now works down a chain of
ways a page can name a field — including a label whose id is built from the
field's, and one that is simply in the same row — and refuses any answer that
reads like a machine name or a widget's status text rather than a question. On
the form that prompted this, the panel went from listing four internal ids to
listing the four questions actually printed on the page.

**A field the page truly never named now goes to the AI reader with the words
around it,** instead of with its id. Asked what an id means, a model can only
guess or decline; asked about the text a person sees standing in front of that
box, it can answer.

**A form's own machinery is no longer listed as questions.** A phone field's
country picker was contributing "Search country with dial code" as though it
were something you had been asked, and a dropdown caught mid-load contributed
"Loading" and "No Results Found". Those are parts and states, not questions.

**Fields that appear twice are counted once.** Some forms render every field a
second time as a hidden template. Both copies carry the same name, and the
hidden one comes first — which is why the visible one's label kept going
unread.

### Added

**CAPTCHAs are named and handed straight back to you.** When a form asks you to
prove a person is present, OfferOS marks it as yours and says so. It does not
attempt them, and it never will: answering one on your behalf would be telling
the employer something untrue about who is filling in the form. Nothing in
OfferOS calls a solving service, by choice rather than by limitation.

**Jobs added from the browser panel get checked on arrival,** the same as jobs
added by pasting a link: is the posting still up, and what will the form ask?
It runs behind the scenes so filling still starts immediately, and if it cannot
read the page nothing breaks — the job is saved either way, and the check is a
button away.

## 2026-08-15

### Security and privacy

**OfferOS no longer asks to read and change your data on every website.** The
browser extension used to request access to all sites at install time. It needed
that for exactly one thing — taking a screenshot of a form after filling it, as
a record of what happened — and Chrome has no narrower way to grant it. So the
install prompt said the broadest possible thing about a product whose whole
claim is that it runs only where you tell it to. That request is gone. What the
extension asks for now is the five application platforms it fills automatically,
plus the local app on your own machine.

**Any other site is a question, asked once, about that site.** Pressing "Enable
OfferOS on this page" on an ordinary careers page now asks Chrome for permission
to that one site, and Chrome asks you, naming it. Say no and nothing happens.
That was always the intent of the button; it is now what actually authorises it,
rather than a boundary drawn on top of access the extension already had.

**What that costs, stated plainly:** the screenshot taken after a fill needs
permission Chrome only grants for the tab you invoked the extension on. When it
is not available the screenshot is skipped — no upload, no record, and no
pretending one was taken. It was always the least important of the three things
OfferOS keeps about a fill (the field-by-field report and the decision trace are
the other two, and neither depends on this), and a missing screenshot has never
been allowed to affect the fill, the report, or marking an application done.

## 2026-08-14

### Fixed

**"Applied" meant three different things depending on where you clicked it.**
Marking an application as sent is five things at once: the fill ticket closes,
the status and the date are set, the work item finishes, the timeline records
it, and enough is kept to take it back. The button in the browser panel did all
five. The agent's version left the ticket open, so a sent application kept
appearing in the panel's list of forms waiting to be filled. And picking
"Applied" from the status dropdown wrote the status and nothing else — no date,
nothing on the timeline, the form still queued, and no way to undo it, because
undo reads the record that path never wrote. All of them go through one place
now, and the shortcut is refused rather than merely avoided.

**Undo works from wherever you marked it,** including the status dropdown, and
including an application that was never opened in the browser panel at all —
added by link, filled by hand, sent. That is a real way to apply for a job.

**A finished form had nothing to say and nowhere to go.** When a fill completed
with nothing left outstanding, the page showed a count and no more; the only
hint that it was waiting on you lived in a separate list. Pressing "Re-fill"
from there failed every time with "Something went wrong". The page now says
what is true at that moment — everything we could fill is filled, go and check
it and submit it yourself — with the two things that can happen next. Filling it
again works.

**Polishing an answer after the form was filled no longer goes unrecorded.**
Between finishing a fill and actually pressing submit you might rewrite an
answer or fix a field by hand. Those changes reached the page but were refused
by the record, so what OfferOS knew about the form stopped matching the form at
exactly the moment it mattered. They are accepted now. What is still refused is
anything arriving after you have said you submitted.

**Re-filling an application you already sent asks first.** It used to quietly
reopen the finished record while leaving it marked as applied.

**Forms left half-open no longer wait forever.** If the browser panel was closed
mid-fill, its ticket stayed open indefinitely and the application kept showing
up as "open the page to fill it" — for a fill that ended weeks ago. Tickets more
than a week old are now retired. And when the same form is open in two places at
once, the second one is told, instead of the two of them silently overwriting
each other.

### Changed

**The timeline says what happened in words.** Several kinds of entry were
rendered as their internal names — `fill-handoff-created`, `instant-fill-started`
— which is not a sentence anyone wrote for a person to read.

**"Ticket created" is gone,** along with the promise attached to it. Opening a
job from OfferOS now says what actually happened, and when the browser extension
is not installed it says that too, instead of promising a panel that is not
there will fill the form.

## 2026-08-13

### Added

**Any careers page, once you ask.** OfferOS reached a form by being present on
the page, and it was only ever present on five application platforms. Most
postings are not on those five — a company's own careers site, a smaller ATS, a
form in another language — and there the panel had nothing to offer and no way
to explain itself. The answer to a list that is too short is not a longer list.
The panel now offers one button on any ordinary web page: press it, and OfferOS
starts reading that page's form. It fills, reports, and asks for what it cannot
answer, exactly as it does on a platform it knows.

**It only runs where you called it.** Outside those five platforms OfferOS does
not appear on a page by itself. Pressing the button turns it on for that tab and
that visit; leaving the page ends it, and coming back means pressing again. It
does not quietly restart itself behind you, because quietly restarting is the
standing presence this is meant to avoid. Pages the browser puts off limits —
its own settings, local files, the extension store — say so plainly instead of
offering a button that could not work.

**A page has to look like an application before OfferOS reads it.** A blog's
comment box and a newsletter signup are both forms. The test is deliberately
strict — a file upload, or at least three labelled questions — and deliberately
wrong in the safe direction: a missed application form leaves you filling it
yourself, which is where you already were, while a false positive would put your
phone number in a box that never asked for it. A page that does not qualify gets
the same "nothing to fill here" an unsupported site has always got.

**Custom dropdowns work without anyone writing a driver for them.** Filling a
non-standard control meant recognising the exact library it was built with, so a
widget nobody had written code for was not filled badly — it was skipped in
silence, and turned up empty at submit. There is now a fallback that reads what
the page publishes about itself for screen readers: which control opens a list,
which rows are its options, which choice is currently checked. Anything a site
described well enough to be accessible is now something OfferOS can operate.

### Changed

**A control that ignores us is reported, not assumed.** The accessibility
description a page publishes is a description, not a promise — a widget can
carry every correct label and still ignore the click. So every dropdown and
every choice ends with OfferOS asking the page whether the answer actually took,
and one that cannot be confirmed is listed among the fields still yours, with
the reason, and a click that jumps you to it.

---

## 2026-08-12

### Added

**A form OfferOS has never seen can now be read.** Field recognition was a fixed
list of English label rules plus three platforms' own field metadata. A form in
another language, or one phrased unusually, produced a page of unrecognised
fields — and an unrecognised field was not merely unfilled, it was untried:
nothing was attempted, and the existing AI answering could not help, because it
only ran on fields already recognised as open-ended questions. There is now a
button that asks a model what those fields are asking for. What comes back is a
MAPPING, never a value: the answer still comes from your profile or your saved
answers, the guards still run, and the write still verifies itself against the
page. So a wrong guess is a visibly wrong field rather than invented text on a
real application, and a guess that names nothing leaves the field honestly
blank. The model is sent field names only — never your name, email, phone, or
any stored answer.

**The model can add a guard, never remove one.** The questions no automation may
answer for you — self-identification, work authorisation — are matched by
English patterns, and the whole point of the above is forms those patterns
cannot read. So the classifier is also asked to flag those questions in any
language, and a flag it raises is honoured. A flag it fails to raise changes
nothing: the existing check runs first and its refusal is never revisited.

**Tell a generated answer what to change about it.** The AI answers panel had
one control: Regenerate — roll the dice again. A draft that was nearly right,
too long or leading with the wrong project, had no way to be told so, and
pressing Regenerate until it came out well was both expensive and likely to lose
the good parts with the bad. Each answer now takes one line of instruction
("shorter", "lead with the ML work"). Your instruction is treated as yours: the
page's question is still fenced off from the model as untrusted text, but what
you typed is not, because fencing it would tell the model to disregard the
person who asked.

**The fields that are still yours, named.** A fill that stopped short said so
only by omission — the counts moved, a few rows stayed pale — and on a long form
that silence reads as completion, which is how an application gets submitted
with required fields empty. There is now a list of exactly what the run did not
finish, in page order, each entry a click away from itself on the page. Fields
the page already holds are never on it, whoever typed them.

### Changed

**Where a filled value came from is said in words** rather than in the engine's
own slug — "from your profile", "from your saved answers", and, for a field a
model placed, "AI-matched field", because that is a different level of
confidence and worth seeing as one.

### Fixed

**A page's identity was a hash of the fields on it.** Every field report was
tagged with the page it came from, so the app could accumulate results across a
multi-page application. But the tag was built by joining every field id on the
page — so adding one question, or the page rendering one fewer, produced a
different tag for the same page. The two sides matched reports on that tag, so
the second fill of a page appended a whole new set instead of replacing the old
one. Field reports are now tagged with the page's actual identity — its address
and its step in the wizard — and a completed fill replaces rather than merges,
which also repairs records already polluted with no migration to run. On a real
application carrying the old data, the report went from 26 rows with 10
questions listed twice to 16 rows, one per question.

**Pressing Done after reopening the panel failed in silence.** A completed fill
moves the application to its submit gate. If the panel was then closed and
reopened, it forgot that it had already reported, so Done looked clickable — and
pressing it sent the report to an application that had moved on, which the app
refused. The panel treated the refusal as nothing at all: no error, no change,
no explanation. The panel now restores what it already reported, so Done is not
offered twice; if a report is refused anyway, the reason appears under the
button instead of vanishing. Replaying the same completed report is now accepted
and lands the same state twice, which is safe because a completed report
replaces.

**A text field the page rejected was still reported as filled.** Every other
write verified itself — a dropdown checked its selection landed, a combobox
waited for the widget to echo the choice, a file upload re-read the attachment —
but the most common write, plain text, set the value and reported success
without ever looking again. A form that refuses programmatic input re-renders
its own empty state, so the field the user saw as answered was blank and the
report agreed it was answered. Text writes are now read back. Reformatting is
not failure (a phone mask is the same answer), but a field that ends up empty or
holding something else is reported as failed and carries the page's own reason,
so it shows up in what needs you instead of at submit.

**iCIMS dropdowns had no driver to answer them.** Supporting an application
platform took agreement between four lists in four files. iCIMS was in three of
them; the one that injects the dropdown driver was written by hand and missed
it. The page loaded, the fields were found, and only the dropdowns silently
failed — each one waiting out a two-and-a-half-second timeout and reporting an
ordinary failure. There is now one list and all four derive from it, so the
lists cannot disagree; a test names a real address per platform and makes each
list prove it covers it.

---

## 2026-08-11

### Added

**An application is a record, not a workflow.** Applying was a pipeline you
stepped through, approving each stage. Each job now gets one page that says each
thing once: the posting, one card for the form, the newest few timeline entries
with the rest a click away, and the documents you have to send. Its state is
yours to set — saved, applying, applied, interview, offer, rejected, archived.
The generation still runs; it just no longer asks permission at each turn. Six
approval gates became zero.

**The job description, in two layers that cost different things.** A posting you
had saved showed you nothing until you paid for a reading. The description is
now always there, collapsed to a dozen lines with the meta you care about (pay
first), with the skills you already have highlighted in the employer's own text
— no upload, no wait, and no call to your model, because your profile is already
on your machine. The reading is the part that costs: one button, one call on
your key, stored so you pay for it once, shown as a peer tab so it never buries
the source.

**The reading answers four questions.** Pay, sponsorship, remote policy and
deadline come back as stated, explicitly ruled out, or not mentioned — three
outcomes, not two. A posting that never mentions sponsorship has not refused it,
and reading silence as a "no" would talk you out of an application you should
make. You can also give the reading a lens ("focus on the pay"), and the page
says which lens produced what you are looking at.

**A workbench for each document.** A generated résumé or cover letter was a
panel inside a larger page. Each now gets a page of its own: the document at
full width, and beside it revise, what changed, the version history with the
reason each version exists, Accept, and PDF. It has an address, so the back
button and a link both behave. On the application itself the two documents
shrink to two lines — state, version, when.

**An agent you can ask about your search.** A conversational agent, on its own
page and inside each application, answers questions about your applications in
plain language — "which of these are stuck, and why?", "what got filled in
here?" — by reading the real records and showing the steps that produced each
answer. It works in a loop of small verified tool calls and can make gated
changes (save an answer, update a status, tailor a résumé), at most two per
turn, each verifying itself by re-reading what it wrote. It cannot mark an
application submitted unless your own message says you submitted it — that check
reads your words, not a model-set flag.

**Job details from the employer's own careers page.** Adding a job worked only
when the link was on a job board's own domain. Most postings are not: companies
embed the board into their own careers page, and a board's own link often
redirects there anyway. The platform behind a page is now recognised from the
page itself, so pasting the link you actually have brings back the title, the
location and the full description. Greenhouse, Lever and Ashby postings are read
from each platform's own listing, whichever domain the link is on.

**It says where the description came from.** The sources are not equally clean:
a platform's own listing is what the employer wrote, while text pulled out of a
page can drag in navigation. One line under the description says which. When a
posting cannot be read at all it says so rather than saving a blank one — some
pages are built entirely in your browser and are not visible to a server.
Settings → Data can retry the ones that came up empty and reports which worked.

**Job reconnaissance.** One click asks the posting two questions: are you still
up, and what will your form ask? On Greenhouse the answer comes from the
platform's own job-board API — every question, its type, and whether it is
required — so the page can say how many required questions there are and how
many you have already answered, and name the ones it cannot. Entirely
deterministic: status codes and the platform's own words, no model anywhere in
it. A site it cannot read gets "could not tell", because a wrong "closed" costs
you a job you could still have applied to.

**Add a job by pasting its link.** On a supported board the title, company and
description come from the board. Anywhere else you get a minimal record with an
editable title, because a guessed company name is worse than a blank one. The
same posting twice opens the one you already have.

**One mark on everything that spends.** Nothing distinguished the buttons that
call your AI provider from the ones that do not. Every button that spends now
carries the same glyph and the same tooltip; every button that does not carries
neither. Checking a posting, filling a form and changing a status are unmarked
because they are free.

**When things happened.** Added, posted, applied, last checked — on one line
under the job title. The posting's own freshness wording is shown as written, a
deadline is only ever one the posting stated, and anything not captured is
absent rather than filled with a placeholder.

**Company faces.** Letters on a colour derived from the company name — offline,
instant, and the same colour for that company forever. When a posting is
checked, its site's icon is fetched once and kept on your machine, so browsing
your own applications never calls an employer's server.

**A downloadable backup.** Your data lives in one local file with no way to move
it. Settings → Data now produces a portable backup you can download.

### Changed

**A wider shell, a roomier nav, and settings that stop jumping.** Switching
settings tabs shifted the whole page, because the scrollbar appeared and
disappeared with the content length. The gutter is now reserved, the shell is
wider, and the navigation is larger; a small motion layer was added so state
changes are visible rather than instantaneous.

**Six settings tabs became two,** with templates separated out of settings
entirely, so the thing you were looking for is not the eleventh item in a row.

### Fixed

**Different jobs counted as the same job.** Adding a posting by link compared
addresses with the whole query string thrown away, on the assumption it only
held tracking parameters. Some boards put the posting's identity there — their
embedded form has an identical path for every job — so every such link looked
like the same job: pasting a new one reported it as already tracked, opened an
unrelated application saved earlier, and created nothing. Only known tracking
parameters are stripped now; everything else is kept and compared in a stable
order, and where a board link carries a readable job identity that is compared
instead, so the same posting is still recognised across both of its link shapes.
A link that genuinely is already tracked now names the job instead of silently
navigating away.

**A degree requirement was scored as a missing skill.** "Computer Science or a
related field" was read literally, so an adjacent degree counted as unmet. The
requirement is now read the inclusive way employers mean it, with your degree
passed in as a fact rather than left in a paragraph to be found. Education is
marked unmet only when a posting names a credential you plainly lack.

**The main action was the one you could not see,** and the workbench header did
not believe its own Accept click until a refresh. Both now match what is in
front of you.

**"Answer this field for me" saved a refusal.** When the agent declined a
question it should not answer, the refusal text was saved into the answer bank
as though it were the answer. It now saves an answer that can be matched, or
saves nothing.

**Recoverable mistakes no longer burn the agent's step budget** or clutter the
trail it shows you, so a run that hit one retryable error still finishes.

### Security

**Every host we fetch is checked — including the ones we are redirected to.**
Checking a posting fetches a page the user pasted. The address was validated
once, before the request; a redirect could then land the request on a private
address on your own network. Each hop is now re-checked against the same rules,
so a redirect cannot reach anywhere the original address could not.

**Résumé text is fenced before it reaches a model.** Text extracted from an
uploaded résumé went into the parsing prompt unfenced, so a document containing
instructions could speak to the model as though it were the app. Résumé text,
cover-letter inputs and scraped page text are all fenced now, and extension
origins are allowlisted rather than pattern-matched.

**Long chat histories are capped on both sides.** Assistant messages were
truncated when replayed into the context window but user messages were not, so a
single pasted description could crowd out the conversation.

---

## 2026-08-10

### Added

**A verification lab for the fill engine.** Captured forms can be replayed
offline through the exact same engine that fills live pages. Three synthetic
test personas with deliberately distinguishable values prove every filled value
came from the active profile — a value carrying another persona's material is
flagged as cross-contamination automatically. Captures that lost information (a
dropdown without its choices, a question without its text) are refused at the
door instead of quietly replaying against a form that never existed. When a real
fill leaves problems behind, the extension photographs those fields and stores
the screenshots beside the database.

**A record of what the forms actually asked.** Each completed fill now stores
the questions it met, identified by their content rather than by any
page-specific id, so the same question on two different postings is recognised
as one question. Fills that went genuinely wrong — a value the page refused, a
required question never seen before, a question failing again on another
application — are recorded separately from fills where a guard simply did its
job. Every figure is a count; no model is involved.

**Workday's button dropdowns can be seen and driven,** and the page watcher
notices them appear, which is what made Workday applications fillable rather
than half-filled.

**Conversation threads, and a write family for the agent.** The agent's history
was one flat log; it now keeps threads, shows what it has in memory, and its
write tools share one contract.

### Fixed

**Two systematic defects that ten live fills exposed,** plus three findings from
the first wave of real-form review: answers now tolerate a question being
reworded, failure counts are honest rather than optimistic, and the evidence
kept is enough to diagnose from.

**The fill report shows what went in, not just what did not.** A report that
lists only problems reads as though nothing worked.

**The submit gate reads the user's words, not the model's flag.** Marking an
application submitted was a field the model could set. It now requires the
user's own message to say so.

**The agent stopped re-reading what it already knew.** Lists arrive
pre-summarised, long tool trails fold, answers synthesize instead of
enumerating, and the shape of the answer follows the shape of the question.

**Evidence screenshots needed a permission they did not have.** Per-host
permissions never satisfy the capture API, so every evidence capture failed
silently.

---

## 2026-08-09

### Added

**A stable identity for a question,** derived from what the question says rather
than from the page it appeared on — which is what lets the same question be
recognised across two employers' forms.

**The field report says why, not just what.** Each field now carries a
plain-language reason for the value chosen, so a wrong answer can be argued with
rather than only observed.

**The page asks what its fields are instead of guessing,** and the extension
knows which page of a multi-page application it is on.

**A fill-quality number, and an honest one** — with failures grouped by cause
rather than listed field by field, so ten symptoms of one problem read as one
problem.

**Ask about a job without leaving the list,** and the list says what happened
rather than which internal step is next.

### Fixed

**The EEO section did not save itself,** and an EEO answer could not be taken
back once given.

**A same-page message did not need a network-sized timeout,** which is why some
in-page operations appeared to hang before failing.

---

## 2026-08-08

### Added

**Three classes of question are refused for AI generation** rather than
answered: identity and demographics, questions with a factual right answer you
alone know (work authorisation, sponsorship, citizenship, salary), and policy
acknowledgements. Policy questions the app did fill are listed afterwards for
you to check.

**The workspace commands the extension.** Fill tasks are bound to a tab
explicitly rather than matched by address, so two similar tabs cannot claim each
other's work.

**An in-page overlay panel,** so the fill panel is reachable from the page
itself and not only from the browser's side panel.

**Self-recovery.** Landing on a posting's description instead of its form, or on
a job-board index, is detected and navigated from, with a per-tab attempt budget
so it cannot loop.

**One-way doors get handles:** marking an application submitted can be undone,
and an evidence check runs before the door closes.

**Live events instead of polling,** so the workspace reflects what is happening
as it happens.

**Auto-submit, off by default, with the consequence stated** — recorded as a
preference and deliberately not implemented.

### Fixed

**Twenty-seven defects from three independent audits** of the foundation, the
console, the guards and the ledger — found by reading the code adversarially
rather than by using it.

**A field the page already holds is an answer.** The fill counted it as empty
and overwrote it; it now counts it and leaves it alone.

**The schema was applied to the file, not to the connection.** Database setup
ran once when a connection opened, and the connection was cached for the life of
the process — so a running app could serve new code over a connection that had
never seen the new schema and fail with a missing table. The schema is now
re-applied whenever the connection is older than the build.

**The extension survives a browser restart,** via a startup sweep and a
self-healing toolbar click.

### Changed

**The panel was split out of a two-thousand-line file,** the extension now
shares the app's definitions instead of copying them, and two copies of the
artifact lane became one.

---

## 2026-08-07

### Added

**Choice groups, per-signal classification, and real titles for label-less
widgets** — the classification work that made radio groups, checkbox groups and
unlabelled custom controls fillable at all.

**One-click EEO defaults, keyword patterns, and AI choice answers,** so the
questions that repeat on every application are answered once.

**Deterministic field ids.** Ids were assigned by a counter that reset on every
content-script reload, so the same name could point at a different field after a
reload — and anything remembered about a field pointed at the wrong one. Ids are
now derived from the field's own content.

---

## 2026-08-06

### Added

**Instant fill.** One click from the side panel fills the form from your
profile, with no application record required first.

**In-panel résumé tailoring and cover letters,** so tailoring, previewing and
attaching all happen at the apply page rather than in another window.

**Live per-field fill progress,** and scan probing that survives a page reload.

**The extension auto-reloads when a fresh build lands,** which turned a
manual reload cycle into about two seconds.

### Fixed

**Company and job id are derived from real page shapes** rather than from what
the documentation implies they are.

---

## 2026-08-02

### Added

**Style memory.** Tweaks you make to generated documents are distilled into
short notes about how you write — style only, never facts — and those notes
ground later generation. Off is off, and the count of what it learned is honest.

**An application event log,** with the timeline and a JSON export.

---

## 2026-08-01

### Added

**Files attach themselves, verified.** A tailored résumé or cover letter is
attached to the form and then confirmed against the page; an attachment that did
not land falls back to telling you to do it manually rather than reporting
success.

**One-click add-this-job from the side panel,** capturing the description from
the page you are on.

**Accepted AI answers persist to the answer bank,** deduplicated, so the second
application asking the same question does not ask you again.

### Security

**Scraped description text is fenced as untrusted** in job analysis, résumé
tailoring and fit analysis, so a posting cannot inject instructions into a
prompt.

---

## 2026-07-27

### Added

**User-readable failure reasons are persisted,** and raw errors are no longer
echoed on a server failure.

### Security

**Content scripts are https-only.** A scheme wildcard also matches plain HTTP,
which would let a network attacker inject a page the fill engine then trusts.

**Local storage is owner-only.** The database, its directory and stored résumés
are created with permissions that exclude other users on the machine.

---

## 2026-07-26

### Added

**Bring your own model.** Anthropic or OpenAI, with your key, managed in the
app. Keys are stored locally and never sent to the browser. System prompts are
editable per task.

**A structured résumé, rendered.** Tailoring works from the résumé you selected,
the workspace shows its structure, and the PDF renderer takes it from there.

### Fixed

**Truthful provider states.** A missing key surfaced as a generic failure
somewhere downstream; onboarding, the workspace banner and the queued label now
each say plainly that no provider is connected.

---

## 2026-07-25

### Added

**Initial public release of OfferOS,** a local-first AI job-application copilot.

**Autofill.** Fills Greenhouse, Lever, Ashby, iCIMS and Workday application
forms from a profile you own. Field classification is a pure, browser-free
library so it can be tested without a browser; the extension only executes what
that library decides. Handles multi-page wizards, React-select comboboxes,
shadow DOM, radio and checkbox groups, and file uploads.

**A workspace that owns the data.** The app holds applications, résumés, answers
and generated documents in a local SQLite file under `~/.offeros`. The browser
extension stores nothing; it asks the app for a ticket, fills the form, and
reports back per field.

**Résumé tailoring and cover letters.** Generate a tailored résumé or a cover
letter for a specific posting, preview the rendered PDF, then attach it — the
attach is a separate click. LaTeX templates are supported; bring your own `.tex`
and mark the body region, or use the built-in one.

**Job analysis and fit.** Summarises a posting, lists gaps against your profile,
and scores fit from deterministic skill overlap. The score is advisory and never
blocks an application.

---

## Security and privacy, throughout

- The local API refuses any request whose `Host` is not loopback, and checks
  `Origin` against an allowlist on every mutating request.
- The database and its directory are created owner-only; résumés live beside it
  on disk, not in a cloud.
- Text the app did not author — page text scraped from a posting, and the text
  extracted from an uploaded résumé — is fenced before it reaches a model.
- Nothing is submitted on your behalf. The submit step waits for you.

## Known gaps

- No released build. Run it from source.
- The local app is started as a development server. That is fine for
  development and is not yet a supportable way to run it day to day.
- Generation runs as deterministic, grounded steps; the conversational agent
  sits above them (triage, diagnosis, small gated changes) rather than driving
  them. This is by design, not a gap — but only the agent's tools carry the
  verify-and-trace contract.
- Reconnaissance reads Greenhouse postings in full. Other boards get the
  is-it-still-up half only; their question lists wait for a real fill.
- The auto-submit preference is recorded and deliberately not implemented.
  Submitting is always yours.
- Your data lives in one local SQLite file. You can export a portable backup
  from Settings → Data; restoring it onto a new machine is a documented manual
  step, not yet a one-click import.
