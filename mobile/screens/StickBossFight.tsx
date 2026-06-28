// Stick Boss Fight — Level 1 mini-game.
// Chunk 4b: full physics + boss AI + win/lose. Player and boss move, punch,
// take damage. Game loop runs at ~60fps via setInterval; visuals via Reanimated
// useAnimatedStyle so animation stays smooth on the UI thread.
// Chunk 4c will: remove DEV-Skip button, remove legacy geometric styles,
// remove debug answer line in App.tsx, add hit particles + polish.

import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, SafeAreaView, Image, Dimensions,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated';

// Brand colors — duplicated from App.tsx for self-containment.
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

// ---------- Ninja asset ----------
// Cute black ninja from OpenGameArt by pechvogel (CC-BY 3.0).
const NINJA_ASPECT = 414 / 333;
const PLAYER_H = 140;
const PLAYER_W = Math.round(PLAYER_H * NINJA_ASPECT);   // ≈ 174
const BOSS_H = 200;
const BOSS_W = Math.round(BOSS_H * NINJA_ASPECT);       // ≈ 249
const ninjaIdle = require('../assets/ninja/idle.png');

// ---------- Game constants (mostly ported verbatim from www/index.html) ----------
const TICK_MS = 16;              // ~60 fps
const GRAVITY = 0.8;             // vy += GRAVITY each tick
const MOVE_ACCEL = 0.6;          // vx increment per tick while holding ◀/▶
const MOVE_SPEED = 3.5;          // |vx| cap
const FRICTION = 0.85;           // vx *= FRICTION each tick
const JUMP_V = -13;              // initial vy on jump (negative = up)
const PUNCH_RANGE = 55;          // distance for player hit to land (web parity)
const PUNCH_COOLDOWN = 18;       // frames between player punches
const BOSS_REACH = 60;           // boss-side equivalent of PUNCH_RANGE
const BOSS_PUNCH_CD = 35;
const HURT_FRAMES = 12;          // hurt-flash duration
const PUNCH_FRAMES = 10;         // punch animation duration
const KNOCKBACK = 6;             // vx kick on a successful hit
const PLAYER_MAX_HP = 100;

// HP scaling — web's formula (line 1042). Level 1 boss = 100, Level 7 = 220.
function bossMaxHpFor(level: number) { return 80 + level * 20; }

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

type AiState = 'approach' | 'retreat' | 'punch' | 'jumpattack';
type Props = { level: number; onWin: () => void; onSignOut: () => void };

// Initial arena width estimate from screen (refined by onLayout once mounted).
const INITIAL_ARENA_W = Dimensions.get('window').width - 32;

export default function StickBossFight({ level, onWin, onSignOut }: Props) {
  // Only flag that needs to re-render the component.
  const [defeated, setDefeated] = useState(false);

  // Boss max HP captured once for this mount (level doesn't change mid-fight).
  const bossMaxHp = bossMaxHpFor(level);

  // ---- Refs (no re-render, no animation) ----
  const keys = useRef({ left: false, right: false, up: false });
  const bossAi = useRef<{ timer: number; state: AiState }>({ timer: 0, state: 'approach' });
  const arenaSize = useRef({ width: INITIAL_ARENA_W });
  const winFired = useRef(false);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Reanimated shared values (60fps animation source) ----
  // Position: x is absolute within the arena. jumpY starts at 0 (grounded);
  // negative jumpY = airborne. vy starts negative on jump, gravity adds to it.
  const playerX = useSharedValue(10);
  const playerJumpY = useSharedValue(0);
  const playerVx = useSharedValue(0);
  const playerVy = useSharedValue(0);
  const playerFacing = useSharedValue(1);          // 1 = right, -1 = left
  const playerHp = useSharedValue(PLAYER_MAX_HP);
  const playerHurt = useSharedValue(0);            // countdown timer
  const playerPunching = useSharedValue(0);
  const playerPunchCD = useSharedValue(0);

  const bossX = useSharedValue(INITIAL_ARENA_W - BOSS_W - 10);
  const bossJumpY = useSharedValue(0);
  const bossVx = useSharedValue(0);
  const bossVy = useSharedValue(0);
  const bossFacing = useSharedValue(-1);
  const bossHp = useSharedValue(bossMaxHp);
  const bossHurt = useSharedValue(0);
  const bossPunching = useSharedValue(0);
  const bossPunchCD = useSharedValue(0);

  // ---- Game loop lifecycle ----
  useEffect(() => {
    startLoop();
    return stopLoop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startLoop() {
    if (loopRef.current) return;  // already running
    loopRef.current = setInterval(tick, TICK_MS);
  }
  function stopLoop() {
    if (loopRef.current) clearInterval(loopRef.current);
    loopRef.current = null;
  }

  // ---- Game loop tick (runs every ~16ms) ----
  function tick() {
    // 1. PLAYER INPUT — hold ◀/▶ accelerates; ▲ tap consumed on jump
    if (keys.current.left)  { playerVx.value -= MOVE_ACCEL; playerFacing.value = -1; }
    if (keys.current.right) { playerVx.value += MOVE_ACCEL; playerFacing.value =  1; }
    if (keys.current.up && playerJumpY.value >= 0) {
      playerVy.value = JUMP_V;
      keys.current.up = false;
    }
    playerVx.value = clamp(playerVx.value, -MOVE_SPEED, MOVE_SPEED);

    // 2. BOSS AI — state machine ported from www/index.html line 1309
    bossAi.current.timer--;
    const dist = playerX.value - bossX.value;
    bossFacing.value = dist > 0 ? 1 : -1;          // always face player

    if (bossAi.current.timer <= 0) {
      const r = Math.random();
      if (Math.abs(dist) > BOSS_REACH - 5) {
        bossAi.current.state = 'approach';
        bossAi.current.timer = 25 + Math.floor(Math.random() * 21);
      } else if (r < 0.70) {
        bossAi.current.state = 'punch';
        bossAi.current.timer = 16;
      } else if (r < 0.85) {
        bossAi.current.state = 'jumpattack';
        bossAi.current.timer = 30;
      } else {
        bossAi.current.state = 'retreat';
        bossAi.current.timer = 15 + Math.floor(Math.random() * 16);
      }
    }

    switch (bossAi.current.state) {
      case 'approach':
        bossVx.value += bossFacing.value * 0.5;
        break;
      case 'retreat':
        bossVx.value -= bossFacing.value * 0.3;
        break;
      case 'punch':
        bossVx.value *= 0.8;
        if (bossPunchCD.value <= 0 && Math.abs(dist) <= BOSS_REACH) {
          bossPunching.value = PUNCH_FRAMES;
          bossPunchCD.value = BOSS_PUNCH_CD;
          tryBossHit();
        }
        break;
      case 'jumpattack':
        bossVx.value += bossFacing.value * 0.4;
        if (bossJumpY.value >= 0) bossVy.value = -9;   // little hop
        if (bossPunchCD.value <= 0 && Math.abs(dist) <= BOSS_REACH + 10) {
          bossPunching.value = PUNCH_FRAMES;
          bossPunchCD.value = 40;
          tryBossHit();
        }
        break;
    }
    bossVx.value = clamp(bossVx.value, -MOVE_SPEED, MOVE_SPEED);

    // 3. PHYSICS — player
    playerVx.value *= FRICTION;
    if (Math.abs(playerVx.value) < 0.05) playerVx.value = 0;
    playerX.value = clamp(playerX.value + playerVx.value, 0, arenaSize.current.width - PLAYER_W);
    playerVy.value += GRAVITY;
    playerJumpY.value += playerVy.value;
    if (playerJumpY.value >= 0) { playerJumpY.value = 0; playerVy.value = 0; }

    // 4. PHYSICS — boss
    bossVx.value *= FRICTION;
    if (Math.abs(bossVx.value) < 0.05) bossVx.value = 0;
    bossX.value = clamp(bossX.value + bossVx.value, 0, arenaSize.current.width - BOSS_W);
    bossVy.value += GRAVITY;
    bossJumpY.value += bossVy.value;
    if (bossJumpY.value >= 0) { bossJumpY.value = 0; bossVy.value = 0; }

    // 5. TIMER DECAY
    if (playerPunching.value > 0) playerPunching.value -= 1;
    if (playerPunchCD.value > 0)  playerPunchCD.value  -= 1;
    if (playerHurt.value > 0)     playerHurt.value     -= 1;
    if (bossPunching.value > 0)   bossPunching.value   -= 1;
    if (bossPunchCD.value > 0)    bossPunchCD.value    -= 1;
    if (bossHurt.value > 0)       bossHurt.value       -= 1;

    // 6. WIN / LOSE
    if (bossHp.value <= 0 && !winFired.current) {
      winFired.current = true;
      stopLoop();
      // Brief pause so the player sees "I beat them!" before celebration overlay.
      setTimeout(onWin, 1200);
    }
    if (playerHp.value <= 0 && !defeated) {
      stopLoop();
      setDefeated(true);
    }
  }

  // ---- Input handlers ----
  function setKey(k: 'left' | 'right' | 'up', v: boolean) {
    keys.current[k] = v;
  }

  function onPunchTap() {
    if (defeated || winFired.current) return;
    if (playerPunchCD.value > 0) return;
    playerPunching.value = PUNCH_FRAMES;
    playerPunchCD.value = PUNCH_COOLDOWN;
    tryPlayerHit();
  }

  // ---- Hit detection ----
  function tryPlayerHit() {
    const dist = Math.abs(playerX.value - bossX.value);
    if (dist > PUNCH_RANGE) return;
    // Must be facing the boss for the hit to count.
    const bossIsRight = bossX.value > playerX.value;
    const facingRight = playerFacing.value === 1;
    if (bossIsRight !== facingRight) return;
    const dmg = 10 + Math.floor(Math.random() * 5);   // 10..14
    bossHp.value = Math.max(0, bossHp.value - dmg);
    bossHurt.value = HURT_FRAMES;
    bossVx.value += playerFacing.value * KNOCKBACK;
  }

  function tryBossHit() {
    const dist = Math.abs(playerX.value - bossX.value);
    if (dist > BOSS_REACH) return;
    const dmg = 5 + Math.floor(Math.random() * 6) + level;   // 5..10 + level
    playerHp.value = Math.max(0, playerHp.value - dmg);
    playerHurt.value = HURT_FRAMES;
    playerVx.value += bossFacing.value * KNOCKBACK;
  }

  // ---- Reset (Try Again on lose) ----
  function resetFight() {
    playerX.value = 10;
    playerJumpY.value = 0;
    playerVx.value = 0;
    playerVy.value = 0;
    playerFacing.value = 1;
    playerHp.value = PLAYER_MAX_HP;
    playerHurt.value = 0;
    playerPunching.value = 0;
    playerPunchCD.value = 0;

    bossX.value = arenaSize.current.width - BOSS_W - 10;
    bossJumpY.value = 0;
    bossVx.value = 0;
    bossVy.value = 0;
    bossFacing.value = -1;
    bossHp.value = bossMaxHp;
    bossHurt.value = 0;
    bossPunching.value = 0;
    bossPunchCD.value = 0;

    bossAi.current = { timer: 0, state: 'approach' };
    winFired.current = false;
    keys.current = { left: false, right: false, up: false };

    setDefeated(false);
    startLoop();
  }

  // Refine the arena width once we know the actual layout. Snaps the boss to
  // the right edge if our estimate was off.
  function onArenaLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    arenaSize.current.width = w;
    if (!winFired.current && !defeated) {
      // Only reposition boss if we haven't started/finished — avoids snapping mid-fight.
      bossX.value = w - BOSS_W - 10;
    }
  }

  // ---- Animated styles ----
  const playerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: playerX.value },
      { translateY: playerJumpY.value },
      { scaleX: playerFacing.value },
      { scale: playerPunching.value > 0 ? 1.08 : 1 },
    ],
    opacity: playerHurt.value > 0 ? 0.5 : 1,
  }));

  const bossStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: bossX.value },
      { translateY: bossJumpY.value },
      { scaleX: bossFacing.value },
      { scale: bossPunching.value > 0 ? 1.08 : 1 },
    ],
    opacity: bossHurt.value > 0 ? 0.5 : 1,
  }));

  const playerHpBarStyle = useAnimatedStyle(() => ({
    width: withTiming(
      `${Math.max(0, playerHp.value) / PLAYER_MAX_HP * 100}%`,
      { duration: 300 }
    ),
  }));

  const bossHpBarStyle = useAnimatedStyle(() => ({
    width: withTiming(
      `${Math.max(0, bossHp.value) / bossMaxHp * 100}%`,
      { duration: 300 }
    ),
  }));

  return (
    <SafeAreaView style={styles.screen}>
      {/* DEV-only skip — now at top:8 (was 50 in chunk 4a, overlapped header).
          Removed entirely in chunk 4c. */}
      <Pressable onPress={onWin} style={styles.devSkip}>
        <Text style={styles.devSkipText}>DEV: Skip Fight (Win)</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.headerText}>Level {level} · vs Stick Lord</Text>
      </View>

      {/* HP bars — width animated via Reanimated withTiming */}
      <View style={styles.hpRow}>
        <View style={styles.hpBlock}>
          <Text style={styles.hpLabel}>YOU</Text>
          <View style={styles.hpBarBg}>
            <Animated.View style={[styles.hpBarFill, { backgroundColor: COLORS.accent }, playerHpBarStyle]} />
          </View>
        </View>
        <View style={styles.hpBlock}>
          <Text style={styles.hpLabel}>BOSS</Text>
          <View style={styles.hpBarBg}>
            <Animated.View style={[styles.hpBarFill, { backgroundColor: COLORS.bad }, bossHpBarStyle]} />
          </View>
        </View>
      </View>

      {/* Arena */}
      <View style={styles.arena} onLayout={onArenaLayout}>
        <Animated.View style={[styles.figureAnchor, playerStyle]}>
          <Image source={ninjaIdle} style={{ width: PLAYER_W, height: PLAYER_H }} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[styles.figureAnchor, bossStyle]}>
          <Image source={ninjaIdle} style={{ width: BOSS_W, height: BOSS_H }} resizeMode="contain" />
        </Animated.View>
        <View style={styles.ground} />

        {/* Inline defeat overlay — semi-transparent, covers arena only */}
        {defeated && (
          <View style={styles.defeatedOverlay}>
            <Text style={styles.defeatedTitle}>Defeated!</Text>
            <Pressable onPress={resetFight} style={styles.tryAgainBtn}>
              <Text style={styles.tryAgainText}>Try Again</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Touch controls — split: D-pad left, jump center, punch right */}
      <View style={styles.controlsRow}>
        <View style={styles.dpad}>
          <Pressable
            onPressIn={() => setKey('left', true)}
            onPressOut={() => setKey('left', false)}
            style={styles.dpadBtn}
          >
            <Text style={styles.btnText}>◀</Text>
          </Pressable>
          <Pressable
            onPressIn={() => setKey('right', true)}
            onPressOut={() => setKey('right', false)}
            style={styles.dpadBtn}
          >
            <Text style={styles.btnText}>▶</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => setKey('up', true)}
          style={styles.jumpBtn}
        >
          <Text style={styles.btnText}>▲</Text>
        </Pressable>
        <Pressable onPress={onPunchTap} style={styles.punchBtn}>
          <Text style={styles.btnText}>👊</Text>
        </Pressable>
      </View>

      <Pressable onPress={onSignOut} style={styles.signOutLink}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },

  // DEV-only skip — chunks 4b only, removed in 4c.
  devSkip: {
    position: 'absolute', top: 8, alignSelf: 'center', zIndex: 10,
    backgroundColor: COLORS.panel, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: COLORS.border,
  },
  devSkipText: { color: COLORS.muted, fontSize: 12, fontWeight: '600' },

  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, alignItems: 'flex-end' },
  headerText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },

  hpRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginTop: 8 },
  hpBlock: { flex: 1 },
  hpLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 },
  hpBarBg: { height: 12, backgroundColor: COLORS.panel, borderRadius: 6, overflow: 'hidden' },
  hpBarFill: { height: '100%', borderRadius: 6 },

  arena: {
    flex: 1, marginHorizontal: 16, marginTop: 16,
    backgroundColor: COLORS.bg, position: 'relative',
    overflow: 'hidden',   // clip figures that escape during knockback
  },
  // Figures are absolutely positioned at the arena's bottom-left;
  // their horizontal position comes from the animated translateX.
  figureAnchor: { position: 'absolute', bottom: 16, left: 0 },
  ground: {
    position: 'absolute', bottom: 16, left: 0, right: 0,
    height: 2, backgroundColor: COLORS.border,
  },

  // Inline defeat overlay — covers the arena only, not HP bars or controls
  defeatedOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(15,18,38,0.85)',
    gap: 20,
  },
  defeatedTitle: { fontSize: 36, fontWeight: '800', color: COLORS.bad, textAlign: 'center' },
  tryAgainBtn: {
    backgroundColor: COLORS.accent, borderRadius: 12,
    paddingHorizontal: 28, paddingVertical: 12, alignItems: 'center',
  },
  tryAgainText: { color: COLORS.bg, fontSize: 18, fontWeight: '700' },

  // ---- LEGACY geometric figure styles (UNUSED — ninjas replaced them) ----
  // Kept through chunk 4b; deleted in chunk 4c cleanup pass.
  figureWrap: { alignItems: 'center', width: 40 },
  head: { width: 24, height: 24, borderRadius: 12, position: 'relative' },
  eye: {
    position: 'absolute', top: 8, width: 4, height: 4, borderRadius: 2,
    backgroundColor: COLORS.bg,
  },
  body: { width: 26, height: 44, borderRadius: 6, marginTop: 4 },
  feet: { width: 30, height: 6, borderRadius: 3, marginTop: 2 },
  figureWrapBig: { width: 48 },
  headBig: { width: 32, height: 32, borderRadius: 16, position: 'relative' },
  eyeAngry: {
    position: 'absolute', top: 11, width: 7, height: 4, borderRadius: 2,
    backgroundColor: COLORS.bg,
  },
  bodyBig: { width: 34, height: 56, borderRadius: 7, marginTop: 4 },
  feetBig: { width: 38, height: 7, borderRadius: 3, marginTop: 2 },
  // ---- end legacy ----

  controlsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 12,
  },
  dpad: { flexDirection: 'row', gap: 8 },
  dpadBtn: {
    width: 56, height: 56, borderRadius: 12, backgroundColor: COLORS.panel,
    borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  jumpBtn: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.panel,
    borderWidth: 2, borderColor: COLORS.good,
    alignItems: 'center', justifyContent: 'center',
  },
  punchBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.panel,
    borderWidth: 2, borderColor: COLORS.bad,
    alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: COLORS.text, fontSize: 22, fontWeight: '800' },

  signOutLink: { padding: 8, alignSelf: 'center', marginBottom: 8 },
  signOutText: { color: COLORS.muted, fontSize: 14 },
});
