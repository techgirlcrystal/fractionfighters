import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ClerkProvider, SignedIn, SignedOut, useSignIn, useSignUp, useAuth,
} from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

// Brand colors — mirror www/index.html :root CSS variables.
const COLORS = {
  bg: '#0f1226',
  panel: '#1b2046',
  accent: '#ffd23f',
  text: '#e8ecff',
  muted: '#9aa3d0',
  bad: '#f87171',
  good: '#4ade80',
  border: '#3a3f7a',
};

// ---------- LEVELS (mirrors www/index.html LEVELS at line 756) ----------
// Level 5's web `op` is the string 'imp'; rendered here as '→' so the op-symbol
// slot stays visually consistent. Subtraction uses Unicode minus '−' (U+2212),
// not '-' (hyphen) — keep this consistent everywhere ops are compared.
type LevelOp = '+' | '−' | '×' | '÷' | '→';
type Level = { op: LevelOp; name: string; activityName: string };

const LEVELS: Level[] = [
  { op: '+', name: 'Addition',        activityName: 'Stick Boss Fight' },
  { op: '−', name: 'Subtraction',     activityName: 'Pencil Break' },
  { op: '×', name: 'Multiplication',  activityName: 'Paper Toss' },
  { op: '÷', name: 'Division',        activityName: 'Tetris (2 min)' },
  { op: '→', name: 'Improper→Proper', activityName: 'Bubble Pop' },
  { op: '+', name: 'Addition',        activityName: 'Connect 4' },
  { op: '−', name: 'Subtraction',     activityName: 'Tic Tac Toe' },
];

// ---------- MATH HELPERS (ported from www/index.html lines 747–851) ----------
function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

function simplify(n: number, d: number): [number, number] {
  if (d === 0) return [n, d];
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return [n / g, d / g];
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Web cycles after 7 levels: LEVELS[(round-1) % LEVELS.length].
// The extra `(... + length) % length` defends against negative numbers.
function levelByNumber(n: number): Level {
  const i = ((n - 1) % LEVELS.length + LEVELS.length) % LEVELS.length;
  return LEVELS[i];
}

type Question = {
  a: number; b: number; c: number; d: number;
  op: LevelOp;
  answerNum: number; answerDen: number; answerWhole: number;
};

// Direct port of www/index.html `makeQuestion()` at line 780.
function makeQuestion(level: Level): Question {
  const op = level.op;
  let a = 0, b = 1, c = 0, d = 1, num = 0, den = 1;

  if (op === '→') {
    // Improper → Proper: improper fraction, student converts to mixed number.
    // Avoid clean integers like 6/3 → 2.
    do {
      b = rand(2, 8);
      a = rand(b + 1, b * 3);
    } while (a % b === 0);
    c = 0; d = 0;
    num = a; den = b;
  } else if (op === '×') {
    b = rand(2, 8); d = rand(2, 8);
    a = rand(1, b - 1); c = rand(1, d - 1);
    num = a * c; den = b * d;
  } else if (op === '÷') {
    b = rand(2, 8); d = rand(2, 8);
    a = rand(1, b - 1); c = rand(1, d - 1);
    num = a * d; den = b * c;
  } else {
    // Addition (+) or Subtraction (−). Pick a difficulty mode at random.
    const mode = Math.random();
    if (mode < 0.35) {
      // like denominators (easy)
      d = rand(2, 8); b = d;
      a = rand(1, d - 1); c = rand(1, d - 1);
    } else if (mode < 0.75) {
      // unlike, friendly LCD (one is a multiple of the other)
      b = rand(2, 5); d = b * rand(2, 3);
      a = rand(1, b - 1); c = rand(1, d - 1);
    } else {
      // unlike, small denominators that share a factor
      const pairs: [number, number][] = [[2,4],[3,6],[2,6],[3,4],[2,3],[4,6],[2,8],[3,8]];
      const [pb, pd] = pairs[rand(0, pairs.length - 1)];
      b = pb; d = pd;
      a = rand(1, b - 1); c = rand(1, d - 1);
    }
    if (op === '+') { num = a*d + c*b; den = b*d; }
    else {
      // ensure positive, non-zero result for subtraction
      if ((a/b) <= (c/d)) { [a, c] = [c, a]; [b, d] = [d, b]; }
      num = a*d - c*b; den = b*d;
    }
  }

  // Zero-numerator guard (defensive; mainly fires for subtraction).
  let guard = 0;
  while (num === 0 && guard < 10) {
    c = rand(1, Math.max(2, d - 1));
    if (op === '+') { num = a*d + c*b; }
    else if (op === '−') { if ((a/b) <= (c/d)) { [a,c]=[c,a]; [b,d]=[d,b]; } num = a*d - c*b; }
    else if (op === '×') { num = a*c; }
    else if (op === '÷') { num = a*d; den = b*c; }
    else { num = a; den = b; }
    guard++;
  }

  let answerWhole = 0, rn: number, rd: number;
  if (op === '→') {
    answerWhole = Math.floor(num / den);
    [rn, rd] = simplify(num % den, den);
  } else {
    [rn, rd] = simplify(num, den);
  }
  return { a, b, c, d, op, answerNum: rn, answerDen: rd, answerWhole };
}

// ---------- AUTH ERROR HELPERS ----------
function errMessage(e: any): string {
  return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'Something went wrong. Try again.';
}

// Clerk's error code when the email doesn't match any existing user.
function isNotFound(e: any): boolean {
  return !!e?.errors?.some?.((er: any) => er?.code === 'form_identifier_not_found');
}

// ---------- SIGNED OUT: email-code (passwordless), unified sign-in + sign-up ----------
function AuthScreen() {
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const [step, setStep] = useState<'email' | 'code'>('email');
  // Tracks which Clerk resource owns the in-flight attempt, so onVerify hits the right method.
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSendCode() {
    if (!signInLoaded || !signUpLoaded) return;
    setBusy(true); setError('');
    try {
      // Try sign-in first — existing accounts (including web users) take this branch.
      const attempt = await signIn.create({ identifier: email });
      const emailFactor: any = attempt.supportedFirstFactors?.find(
        (f: any) => f.strategy === 'email_code'
      );
      if (!emailFactor) {
        setError('Email-code sign-in is not enabled for this account.');
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: emailFactor.emailAddressId,
      });
      setMode('signIn');
      setStep('code');
    } catch (e: any) {
      if (isNotFound(e)) {
        // New email — fall through to sign-up.
        try {
          await signUp.create({ emailAddress: email });
          await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
          setMode('signUp');
          setStep('code');
        } catch (e2) {
          setError(errMessage(e2));
        }
      } else {
        setError(errMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    setBusy(true); setError('');
    try {
      if (mode === 'signIn') {
        const res = await signIn!.attemptFirstFactor({ strategy: 'email_code', code });
        if (res.status === 'complete') await setSignInActive({ session: res.createdSessionId });
        else setError('Could not finish signing in. Try again.');
      } else {
        const res = await signUp!.attemptEmailAddressVerification({ code });
        if (res.status === 'complete') await setSignUpActive({ session: res.createdSessionId });
        else setError('Could not verify. Check the code and try again.');
      }
    } catch (e) { setError(errMessage(e)); }
    finally { setBusy(false); }
  }

  function resetToEmail() {
    setStep('email');
    setCode('');
    setError('');
  }

  if (step === 'code') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>We sent a 6-digit code to {email}.</Text>
          <TextInput
            style={styles.input} placeholder="Verification code"
            placeholderTextColor={COLORS.muted}
            value={code} onChangeText={setCode}
            keyboardType="number-pad" autoCapitalize="none"
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            onPress={onVerify} disabled={busy || !code}
            style={({ pressed }) => [
              styles.primaryButton,
              (busy || !code) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            {busy ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.primaryButtonText}>Verify</Text>}
          </Pressable>
          <Pressable onPress={resetToEmail}>
            <Text style={styles.linkText}>Use a different email</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <Text style={styles.title}>Fighting Fractions</Text>
        <Text style={styles.subtitle}>Enter your email — we'll send you a code.</Text>
        <TextInput
          style={styles.input} placeholder="Email"
          placeholderTextColor={COLORS.muted}
          value={email} onChangeText={setEmail}
          autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
        />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          onPress={onSendCode} disabled={busy || !email}
          style={({ pressed }) => [
            styles.primaryButton,
            (busy || !email) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {busy ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.primaryButtonText}>Send Code</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ---------- FRACTION DISPLAY ----------
function Fraction({ num, den, color }: { num: string | number; den: string | number; color?: string }) {
  const fg = color ?? COLORS.text;
  return (
    <View style={styles.frac}>
      <Text style={[styles.fracTop, { color: fg, borderBottomColor: fg }]}>{num}</Text>
      <Text style={[styles.fracBot, { color: fg }]}>{den}</Text>
    </View>
  );
}

// ---------- SIGNED IN: Gameplay (chunk 2 — answer inputs + Check Answer + feedback) ----------
function GameplayScreen() {
  const { signOut } = useAuth();

  // Hardcoded for chunk 2. Real /api/players → currentLevel auto-routing lands
  // in chunk 3; the fetch code lives in git at commit 67caaee for reference.
  const levelNumber = 1;
  const level = levelByNumber(levelNumber);

  const [question, setQuestion] = useState<Question>(() => makeQuestion(level));
  const [numInput, setNumInput] = useState('');
  const [denInput, setDenInput] = useState('');
  type Feedback = { kind: 'idle' | 'correct' | 'wrong'; message: string };
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle', message: '' });

  // When the user starts retyping after a wrong answer, clear the red message.
  // (They've seen it; now they're correcting it — don't keep yelling at them.)
  useEffect(() => {
    if (feedback.kind === 'wrong' && (numInput || denInput)) {
      setFeedback({ kind: 'idle', message: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numInput, denInput]);

  function advanceToNextQuestion() {
    setQuestion(makeQuestion(level));
    setNumInput('');
    setDenInput('');
    setFeedback({ kind: 'idle', message: '' });
  }

  function onCheckAnswer() {
    const un = parseInt(numInput, 10);
    const ud = parseInt(denInput, 10);

    if (isNaN(un) || isNaN(ud) || ud === 0) {
      setFeedback({ kind: 'wrong', message: "Type a number on top and bottom (bottom can't be 0)." });
      return;
    }

    // Cross-multiplication equivalence (ported from web index.html:960).
    // Accepts any equivalent fraction — e.g. 2/4 for 1/2.
    const correct = un * question.answerDen === question.answerNum * ud;

    if (correct) {
      setFeedback({ kind: 'correct', message: 'Correct!' });
      // Brief celebration, then a fresh question. No cleanup ref this chunk —
      // worst case is a no-op state update if the user signs out mid-pause.
      setTimeout(advanceToNextQuestion, 1500);
    } else {
      setFeedback({ kind: 'wrong', message: 'Try again.' });
    }
  }

  // Color the '?/?' fraction green when correct, red when wrong, default otherwise.
  const answerColor =
    feedback.kind === 'correct' ? COLORS.good :
    feedback.kind === 'wrong'   ? COLORS.bad  :
    undefined;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header banner */}
      <View style={styles.gameHeader}>
        <Text style={styles.gameHeaderLevel}>Level {levelNumber} · {level.name}</Text>
        <Text style={styles.gameHeaderActivity}>{level.activityName}</Text>
      </View>

      {/* Centered question + inputs + check button + feedback */}
      <View style={styles.questionArea}>
        <View style={styles.questionRow}>
          <Fraction num={question.a} den={question.b} />
          <Text style={styles.opSymbol}>{question.op}</Text>
          <Fraction num={question.c} den={question.d} />
          <Text style={styles.equals}>=</Text>
          <Fraction num="?" den="?" color={answerColor} />
        </View>

        {/* Debug only this chunk: shows the computed simplified answer.
            Level 1 never has answerWhole; we'll handle mixed display later. */}
        <Text style={styles.debugAnswer}>
          (Answer: {question.answerNum}/{question.answerDen})
        </Text>

        {/* Horizontal '[num] / [den]' input row, mirrors web .answer-row */}
        <View style={styles.inputsRow}>
          <TextInput
            style={styles.answerInput}
            placeholder="?" placeholderTextColor={COLORS.muted}
            value={numInput} onChangeText={setNumInput}
            keyboardType="number-pad" autoCapitalize="none"
            editable={feedback.kind !== 'correct'}
          />
          <Text style={styles.inputBar}>/</Text>
          <TextInput
            style={styles.answerInput}
            placeholder="?" placeholderTextColor={COLORS.muted}
            value={denInput} onChangeText={setDenInput}
            keyboardType="number-pad" autoCapitalize="none"
            editable={feedback.kind !== 'correct'}
          />
        </View>

        <Pressable
          onPress={onCheckAnswer}
          disabled={feedback.kind === 'correct'}
          style={({ pressed }) => [
            styles.checkButton,
            feedback.kind === 'correct' && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.checkButtonText}>Check Answer</Text>
        </Pressable>

        {/* Feedback line — reserves space (minHeight) so layout doesn't jump */}
        <Text style={[
          styles.feedbackText,
          feedback.kind === 'correct' && styles.feedbackGood,
          feedback.kind === 'wrong'   && styles.feedbackBad,
        ]}>
          {feedback.message}
        </Text>
      </View>

      {/* Footer: just Sign out now (New question auto-replaced by auto-advance) */}
      <View style={styles.footerLinks}>
        <Pressable onPress={() => signOut()} style={styles.linkButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ---------- ROOT ----------
export default function App() {
  if (!publishableKey) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.error}>
            Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Check mobile/.env.local and restart Expo.
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SignedOut><AuthScreen /></SignedOut>
      <SignedIn><GameplayScreen /></SignedIn>
      <StatusBar style="light" />
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  // Layout
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },

  // Typography (shared by AuthScreen)
  title: {
    fontSize: 32, fontWeight: '800', textAlign: 'center', color: COLORS.accent,
    textShadowColor: '#000', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0,
  },
  subtitle: { fontSize: 15, color: COLORS.muted, textAlign: 'center', marginBottom: 16 },
  error: { color: COLORS.bad, fontSize: 14, textAlign: 'center' },

  // Inputs (Auth)
  input: {
    width: '100%', backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 8, padding: 14, fontSize: 16, color: COLORS.text,
  },

  // Primary action (yellow button, dark text) — used by AuthScreen
  primaryButton: {
    width: '100%', backgroundColor: COLORS.accent, borderRadius: 8, padding: 16,
    alignItems: 'center', marginTop: 4,
  },
  primaryButtonText: { color: COLORS.bg, fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8 },

  // Link-style text (Use a different email)
  linkText: { color: COLORS.accent, fontSize: 14, marginTop: 8 },

  // Gameplay header banner — level info, top-aligned, muted text
  gameHeader: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12, alignItems: 'center' },
  gameHeaderLevel: { color: COLORS.muted, fontSize: 16, fontWeight: '700' },
  gameHeaderActivity: { color: COLORS.muted, fontSize: 13, marginTop: 2 },

  // Centered question area takes the rest of the screen
  questionArea: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  // flexWrap is a safety net for multi-digit numerators in future levels.
  questionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },

  // Fraction display — flexbox column with a border-bottom on the numerator
  // is the exact RN translation of web's .frac CSS (lines 106–116).
  frac: { flexDirection: 'column', alignItems: 'center', marginHorizontal: 4 },
  fracTop: {
    fontSize: 40, fontWeight: '800', color: COLORS.text,
    borderBottomWidth: 3, borderBottomColor: COLORS.text,
    paddingHorizontal: 8, lineHeight: 48, textAlign: 'center',
  },
  fracBot: {
    fontSize: 40, fontWeight: '800', color: COLORS.text,
    paddingHorizontal: 8, lineHeight: 48, textAlign: 'center',
  },
  opSymbol: { fontSize: 40, fontWeight: '800', color: COLORS.accent, marginHorizontal: 4 },
  equals: { fontSize: 40, fontWeight: '800', color: COLORS.text, marginHorizontal: 4 },

  // Debug answer line under the question (this chunk only — will go away
  // when we trust the generator + check logic)
  debugAnswer: { color: COLORS.muted, fontSize: 12, fontStyle: 'italic', marginTop: 12 },

  // Answer input boxes — horizontal '[num] / [den]', mirrors web .answer-row
  inputsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20 },
  answerInput: {
    width: 80, height: 56, backgroundColor: '#0a0d24',
    borderWidth: 3, borderColor: COLORS.border, borderRadius: 10,
    textAlign: 'center', fontSize: 28, fontWeight: '700', color: COLORS.text,
    padding: 0,
  },
  inputBar: { color: COLORS.muted, fontSize: 30, fontWeight: '700' },

  // Check Answer button — yellow pill, centered (not full-width like AuthScreen primary)
  checkButton: {
    backgroundColor: COLORS.accent, borderRadius: 12,
    paddingHorizontal: 28, paddingVertical: 12, alignItems: 'center', marginTop: 16,
  },
  checkButtonText: { color: COLORS.bg, fontSize: 18, fontWeight: '700' },

  // Feedback message — fixed minHeight so layout doesn't shift between states
  feedbackText: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 12, minHeight: 26 },
  feedbackGood: { color: COLORS.good },
  feedbackBad: { color: COLORS.bad },

  // Footer links — Sign out only this chunk (New question link removed)
  footerLinks: { paddingBottom: 16, alignItems: 'center', gap: 4 },
  linkButton: { padding: 8 },
  signOutText: { color: COLORS.muted, fontSize: 14 },
});
