# How to run Fuksipisteet on your own computer

No coding needed. You will install 2 free programs, download the app, and type a few commands that you can copy and paste from this page. The first time takes about 20–30 minutes, mostly waiting for downloads.

Works on Windows and Mac.

---

## Part 1: Install 2 programs (only once)

### 1. Node.js (runs the app)
1. Go to **https://nodejs.org**
2. Click the big green **LTS** download button.
3. Open the downloaded file and click **Next / Continue** on every screen (the default options are fine).

### 2. Docker Desktop (runs the app's database)
1. Go to **https://www.docker.com/products/docker-desktop/**
2. Download the version for your computer (Windows, or Mac with Apple chip / Intel chip).
3. Install it with the default options. **On Windows**, if it asks to install "WSL" or to restart the computer, say yes.
4. Open **Docker Desktop**. Accept the terms. You can skip signing in.
5. Wait until it says Docker is **running** (bottom-left corner turns green). Keep Docker Desktop open whenever you use the app.

---

## Part 2: Download the app (only once)

1. Open the project page on GitHub.
2. Click the green **Code** button, then **Download ZIP**.
3. Find the ZIP in your Downloads folder and unzip it:
   - **Windows:** right-click it, **Extract All**, **Extract**.
   - **Mac:** double-click it.
4. You now have a folder (named something like `dawg-main`). Move it somewhere easy, like your Desktop.

---

## Part 3: Open a terminal in the app folder

A terminal is a window where you type commands. You must open it **inside the app folder**.

- **Windows:** open the app folder in File Explorer. Click the address bar at the top (where the folder path is), type `powershell` and press **Enter**. A blue or black window opens.
- **Mac:** open the **Terminal** app (press Cmd + Space, type `Terminal`, press Enter). Type `cd ` (with a space after it), then drag the app folder from Finder into the Terminal window and press **Enter**.

> **How to run a command:** copy one line from the grey boxes below, paste it into the terminal (right-click on Windows, Cmd + V on Mac), press **Enter**, and wait until it finishes, meaning you can type again.

---

## Part 4: First-time setup (only once)

**Step 1.** Download the app's building blocks (takes a few minutes, lots of text scrolls by, that's normal):
```
npm install
```

**Step 2.** Start the database (the first time downloads a lot, so it can take 5–15 minutes; Docker Desktop must be open):
```
npx supabase start
```
When it finishes, it prints a list of addresses and keys. **Keep this window open.** You need two values from that list:
- the **API URL** (it may be called **Project URL**). It looks like `http://127.0.0.1:54321`
- the **anon key** (if there is no "anon key", use the **Publishable key**). A long line of letters and numbers.

**Step 3.** Create the settings file:
```
cp .env.example .env.local
```

**Step 4.** Open the settings file:
- **Windows:**
  ```
  notepad .env.local
  ```
- **Mac:**
  ```
  open -e .env.local
  ```

**Step 5.** In the file that opens, fill in the two lines so they look like this, using your own values from Step 2. Paste right after the `=` sign, with no spaces:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste-the-long-key-here
```
Leave every other line as it is. **Save** (Ctrl + S or Cmd + S) and close the file.

---

## Part 5: Start the app (every time)

```
npm run demo
```
Wait until you see **Ready**. Then open your web browser and go to:

**http://localhost:3000**

Pick a person under **"Choose your character"** to try the app as a fuksi, tutor, captain or organizer.

- Leave the terminal window open while you use the app. Closing it stops the app.
- If the app asks for a login code sent by email: no real email is sent. Open **http://127.0.0.1:54324** to see the code.

---

## Next time you want to use it

1. Open **Docker Desktop** and wait until it is running.
2. Open a terminal in the app folder (Part 3).
3. Run these two, one at a time:
   ```
   npx supabase start
   ```
   ```
   npm run demo
   ```
4. Go to **http://localhost:3000**.

## When you are done

1. Click the terminal window and press **Ctrl + C** to stop the app.
2. Stop the database:
   ```
   npx supabase stop
   ```
3. You can now close the terminal and Docker Desktop.

## Getting a newer version of the app

1. In the old folder's terminal, run `npx supabase stop`.
2. Download the ZIP again (Part 2) and do Part 3 and Part 4 in the new folder.
3. Then run this once, so the database gets the new version too. It deletes anything you tried out in the app and loads fresh demo data:
   ```
   npx supabase db reset
   ```
4. Start the app as usual (Part 5).

---

## Something went wrong?

| What you see | What to do |
|---|---|
| `npm` or `npx` "is not recognized" / "command not found" | Node.js isn't installed yet, or the terminal was open while you installed it. Install Node.js (Part 1), then close the terminal and open a new one. |
| Windows: "running scripts is disabled on this system" | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, type `Y` and press Enter, then try again. |
| "Cannot connect to the Docker daemon" / "docker API" / "pipe" error | Docker Desktop isn't running. Open it, wait until it is green, then try again. |
| "port is already allocated" / "already running" | Run `npx supabase stop`, then `npx supabase start` again. |
| The page opens but shows no data, or errors | The two values in `.env.local` are wrong. Run `npx supabase status` to see them again, redo Part 4 Steps 4–5, then stop the app (Ctrl + C) and run `npm run demo` again. |
| http://localhost:3000 won't open | The app isn't running. Check the terminal: run `npm run demo` and wait for **Ready**. |

Still stuck? Take a screenshot of the terminal and send it to the team.
