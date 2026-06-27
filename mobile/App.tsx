import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ClerkProvider, SignedIn, SignedOut, useSignIn, useSignUp, useUser, useAuth,
} from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

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
      <View style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>We sent a 6-digit code to {email}.</Text>
        <TextInput
          style={styles.input} placeholder="Verification code" value={code}
          onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none"
        />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={styles.button} onPress={onVerify} disabled={busy || !code}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
        </Pressable>
        <Pressable onPress={resetToEmail}>
          <Text style={styles.toggle}>Use a different email</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fighting Fractions</Text>
      <Text style={styles.subtitle}>Enter your email — we'll send you a code.</Text>
      <TextInput
        style={styles.input} placeholder="Email" value={email} onChangeText={setEmail}
        autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={onSendCode} disabled={busy || !email}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Code</Text>}
      </Pressable>
    </View>
  );
}

// ---------- SIGNED IN: Welcome + Sign Out ----------
function WelcomeScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const name = user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? 'friend';
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome {name}!</Text>
      <Pressable style={styles.button} onPress={() => signOut()}>
        <Text style={styles.buttonText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

// ---------- ROOT ----------
export default function App() {
  if (!publishableKey) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>
          Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Check mobile/.env.local and restart Expo.
        </Text>
      </View>
    );
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SignedOut><AuthScreen /></SignedOut>
      <SignedIn><WelcomeScreen /></SignedIn>
      <StatusBar style="auto" />
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 8 },
  input: { width: '100%', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 14, fontSize: 16 },
  button: { width: '100%', backgroundColor: '#3b5bdb', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  toggle: { color: '#3b5bdb', fontSize: 14, marginTop: 8 },
  error: { color: '#c92a2a', fontSize: 14, textAlign: 'center' },
});
