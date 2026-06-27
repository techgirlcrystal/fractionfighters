import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  ScrollView, SafeAreaView, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ClerkProvider, SignedIn, SignedOut, useSignIn, useSignUp, useUser, useAuth,
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
  border: '#3a3f7a',
};

// Mirrors www/index.html LEVELS (line 756). Level 5's web `op` is the string
// 'imp'; rendered here as '→' so the op-symbol slot stays visually consistent.
const LEVELS = [
  { op: '+', name: 'Addition',        activityName: 'Stick Boss Fight' },
  { op: '−', name: 'Subtraction',     activityName: 'Pencil Break' },
  { op: '×', name: 'Multiplication',  activityName: 'Paper Toss' },
  { op: '÷', name: 'Division',        activityName: 'Tetris (2 min)' },
  { op: '→', name: 'Improper→Proper', activityName: 'Bubble Pop' },
  { op: '+', name: 'Addition',        activityName: 'Connect 4' },
  { op: '−', name: 'Subtraction',     activityName: 'Tic Tac Toe' },
];

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

// ---------- SIGNED IN: Level Menu ----------
function LevelMenuScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const name =
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ??
    'friend';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.menuScroll}>
        <Text style={styles.title}>Fighting Fractions</Text>
        <Text style={styles.subtitle}>Welcome, {name}</Text>

        {LEVELS.map((lvl, i) => {
          const num = i + 1;
          return (
            <Pressable
              key={num}
              onPress={() =>
                Alert.alert('Coming soon', `Level ${num}: ${lvl.name} · ${lvl.activityName}`)
              }
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <Text style={styles.cardNumber}>{num}</Text>
              <Text style={styles.cardOp}>{lvl.op}</Text>
              <View style={styles.cardTextWrap}>
                <Text style={styles.cardName}>{lvl.name}</Text>
                <Text style={styles.cardActivity}>{lvl.activityName}</Text>
              </View>
            </Pressable>
          );
        })}

        <Pressable onPress={() => signOut()} style={styles.signOutLink}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
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
      <SignedIn><LevelMenuScreen /></SignedIn>
      <StatusBar style="light" />
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  // Layout
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  menuScroll: { padding: 24, gap: 12, alignItems: 'stretch' },

  // Typography
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

  // Primary action (yellow button, dark text)
  primaryButton: {
    width: '100%', backgroundColor: COLORS.accent, borderRadius: 8, padding: 16,
    alignItems: 'center', marginTop: 4,
  },
  primaryButtonText: { color: COLORS.bg, fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8 },

  // Link-style text (Use a different email)
  linkText: { color: COLORS.accent, fontSize: 14, marginTop: 8 },

  // Level cards
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.panel,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, gap: 14,
  },
  cardPressed: { opacity: 0.75 },
  cardNumber: { color: COLORS.muted, fontSize: 24, fontWeight: '700', width: 28, textAlign: 'center' },
  cardOp: { color: COLORS.accent, fontSize: 32, fontWeight: '800', width: 36, textAlign: 'center' },
  cardTextWrap: { flex: 1 },
  cardName: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  cardActivity: { color: COLORS.muted, fontSize: 14, marginTop: 2 },

  // Sign out (small text link at the bottom of menu)
  signOutLink: { marginTop: 16, alignItems: 'center', padding: 8 },
  signOutText: { color: COLORS.muted, fontSize: 14 },
});
