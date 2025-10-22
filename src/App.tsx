import { useState, useEffect, useRef } from 'react';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, Auth, User } from 'firebase/auth';
import { getFirestore, Firestore, collection, doc, setDoc, getDoc, getDocs, query, where, onSnapshot, addDoc, orderBy, Timestamp, writeBatch, limit } from 'firebase/firestore';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Heart, X, MessageCircle, Users, Swords, ArrowLeft, Send, Crown, CheckCircle } from 'lucide-react';

declare global {
  interface Window {
    __firebase_config?: any;
    __app_id?: string;
    __initial_auth_token?: string;
  }
}

type Screen = 'loading' | 'profile' | 'discovery' | 'matches' | 'chat' | 'practice';

interface Profile {
  userId: string;
  name: string;
  profilePhotoUrl: string;
  chessRating: number;
  strategyPhilosophy: string;
}

interface Match {
  userId: string;
  matchedAt: number;
  icebreakerCompleted?: boolean;
  icebreakerAnswer?: string;
  profile?: Profile;
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
}

function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [firebaseApp, setFirebaseApp] = useState<FirebaseApp | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appId, setAppId] = useState<string>('');

  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [discoveryProfiles, setDiscoveryProfiles] = useState<Profile[]>([]);
  const [currentDiscoveryIndex, setCurrentDiscoveryIndex] = useState(0);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [newMatchName, setNewMatchName] = useState('');

  const [icebreakerAnswer, setIcebreakerAnswer] = useState('');
  const [showIcebreaker, setShowIcebreaker] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [chess, setChess] = useState(new Chess());
  const [gamePosition, setGamePosition] = useState(chess.fen());
  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState('');
  const [timeLeft, setTimeLeft] = useState(600);
  const [gameStarted, setGameStarted] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [profileForm, setProfileForm] = useState({
    name: '',
    profilePhotoUrl: 'https://images.pexels.com/photos/1040881/pexels-photo-1040881.jpeg?auto=compress&cs=tinysrgb&w=400',
    chessRating: 1500,
    strategyPhilosophy: ''
  });

  useEffect(() => {
    initializeFirebase();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (gameStarted && !gameOver) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            endGame('Time out! You lose.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [gameStarted, gameOver]);

  const initializeFirebase = async () => {
    try {
      const config = window.__firebase_config || {
        apiKey: "demo-api-key",
        authDomain: "demo.firebaseapp.com",
        projectId: "demo-project",
        storageBucket: "demo.appspot.com",
        messagingSenderId: "123456789",
        appId: "1:123456789:web:abcdef"
      };

      const appIdVal = window.__app_id || 'chessmate-demo';
      setAppId(appIdVal);

      const app = initializeApp(config);
      const authInstance = getAuth(app);
      const dbInstance = getFirestore(app);

      setFirebaseApp(app);
      setAuth(authInstance);
      setDb(dbInstance);

      let userCredential;
      if (window.__initial_auth_token) {
        userCredential = await signInWithCustomToken(authInstance, window.__initial_auth_token);
      } else {
        userCredential = await signInAnonymously(authInstance);
      }

      setUser(userCredential.user);
      await loadUserProfile(dbInstance, appIdVal, userCredential.user.uid);
    } catch (error) {
      console.error('Firebase initialization error:', error);
      setScreen('profile');
    }
  };

  const loadUserProfile = async (dbInstance: Firestore, appIdVal: string, userId: string) => {
    try {
      const profileRef = doc(dbInstance, `artifacts/${appIdVal}/public/data/datingProfiles`, userId);
      const profileSnap = await getDoc(profileRef);

      if (profileSnap.exists()) {
        const data = profileSnap.data() as Profile;
        setCurrentProfile({ ...data, userId });
        setScreen('discovery');
        loadDiscoveryProfiles(dbInstance, appIdVal, userId);
        loadMatches(dbInstance, appIdVal, userId);
      } else {
        setScreen('profile');
      }
    } catch (error) {
      console.error('Profile load error:', error);
      setScreen('profile');
    }
  };

  const createProfile = async () => {
    if (!db || !user || !appId) return;
    if (!profileForm.name || !profileForm.strategyPhilosophy) {
      alert('Please fill in all fields');
      return;
    }

    try {
      const profile: Profile = {
        userId: user.uid,
        ...profileForm
      };

      const profileRef = doc(db, `artifacts/${appId}/public/data/datingProfiles`, user.uid);
      await setDoc(profileRef, profile);

      setCurrentProfile(profile);
      setScreen('discovery');
      loadDiscoveryProfiles(db, appId, user.uid);
      loadMatches(db, appId, user.uid);
    } catch (error) {
      console.error('Profile creation error:', error);
      alert('Failed to create profile');
    }
  };

  const loadDiscoveryProfiles = async (dbInstance: Firestore, appIdVal: string, userId: string) => {
    try {
      const profilesRef = collection(dbInstance, `artifacts/${appIdVal}/public/data/datingProfiles`);
      const swipesRef = collection(dbInstance, `artifacts/${appIdVal}/users/${userId}/swipes`);

      const profilesSnap = await getDocs(profilesRef);
      const swipesSnap = await getDocs(swipesRef);

      const swipedIds = new Set(swipesSnap.docs.map(doc => doc.id));

      const availableProfiles = profilesSnap.docs
        .filter(doc => doc.id !== userId && !swipedIds.has(doc.id))
        .map(doc => ({ ...doc.data(), userId: doc.id } as Profile));

      setDiscoveryProfiles(availableProfiles);
      setCurrentDiscoveryIndex(0);
    } catch (error) {
      console.error('Discovery profiles load error:', error);
    }
  };

  const handleSwipe = async (liked: boolean) => {
    if (!db || !user || !appId || currentDiscoveryIndex >= discoveryProfiles.length) return;

    const targetProfile = discoveryProfiles[currentDiscoveryIndex];

    try {
      const swipeRef = doc(db, `artifacts/${appId}/users/${user.uid}/swipes`, targetProfile.userId);
      await setDoc(swipeRef, {
        liked,
        swipedAt: Timestamp.now()
      });

      if (liked) {
        const theirSwipeRef = doc(db, `artifacts/${appId}/users/${targetProfile.userId}/swipes`, user.uid);
        const theirSwipeSnap = await getDoc(theirSwipeRef);

        if (theirSwipeSnap.exists() && theirSwipeSnap.data()?.liked) {
          const batch = writeBatch(db);

          const myMatchRef = doc(db, `artifacts/${appId}/users/${user.uid}/matches`, targetProfile.userId);
          batch.set(myMatchRef, {
            matchedAt: Timestamp.now(),
            icebreakerCompleted: false
          });

          const theirMatchRef = doc(db, `artifacts/${appId}/users/${targetProfile.userId}/matches`, user.uid);
          batch.set(theirMatchRef, {
            matchedAt: Timestamp.now(),
            icebreakerCompleted: false
          });

          await batch.commit();

          setNewMatchName(targetProfile.name);
          setShowMatchModal(true);

          setTimeout(() => {
            setShowMatchModal(false);
            loadMatches(db, appId, user.uid);
          }, 3000);
        }
      }

      setCurrentDiscoveryIndex(prev => prev + 1);
    } catch (error) {
      console.error('Swipe error:', error);
    }
  };

  const loadMatches = async (dbInstance: Firestore, appIdVal: string, userId: string) => {
    try {
      const matchesRef = collection(dbInstance, `artifacts/${appIdVal}/users/${userId}/matches`);
      const matchesSnap = await getDocs(matchesRef);

      const matchPromises = matchesSnap.docs.map(async (matchDoc) => {
        const matchData = matchDoc.data();
        const profileRef = doc(dbInstance, `artifacts/${appIdVal}/public/data/datingProfiles`, matchDoc.id);
        const profileSnap = await getDoc(profileRef);

        return {
          userId: matchDoc.id,
          matchedAt: matchData.matchedAt?.seconds || 0,
          icebreakerCompleted: matchData.icebreakerCompleted || false,
          icebreakerAnswer: matchData.icebreakerAnswer,
          profile: profileSnap.exists() ? { ...profileSnap.data(), userId: matchDoc.id } as Profile : undefined
        };
      });

      const matchesData = await Promise.all(matchPromises);
      setMatches(matchesData.filter(m => m.profile));
    } catch (error) {
      console.error('Matches load error:', error);
    }
  };

  const selectMatch = (match: Match) => {
    setSelectedMatch(match);

    if (!match.icebreakerCompleted) {
      setShowIcebreaker(true);
      setIcebreakerAnswer('');
    } else {
      setScreen('chat');
      loadChat(match.userId);
    }
  };

  const submitIcebreaker = async () => {
    if (!db || !user || !appId || !selectedMatch || !icebreakerAnswer.trim()) {
      alert('Please answer the icebreaker question');
      return;
    }

    try {
      const matchRef = doc(db, `artifacts/${appId}/users/${user.uid}/matches`, selectedMatch.userId);
      await setDoc(matchRef, {
        icebreakerCompleted: true,
        icebreakerAnswer: icebreakerAnswer,
        matchedAt: Timestamp.now()
      }, { merge: true });

      setShowIcebreaker(false);
      setScreen('chat');
      loadChat(selectedMatch.userId);
      loadMatches(db, appId, user.uid);
    } catch (error) {
      console.error('Icebreaker submission error:', error);
      alert('Failed to submit icebreaker');
    }
  };

  const loadChat = (matchUserId: string) => {
    if (!db || !user || !appId) return;

    const chatId = [user.uid, matchUserId].sort().join('_');
    const messagesRef = collection(db, `artifacts/${appId}/chats/${chatId}/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.seconds || 0
      } as Message));
      setMessages(msgs);
    });

    return unsubscribe;
  };

  const sendMessage = async () => {
    if (!db || !user || !appId || !selectedMatch || !messageInput.trim()) return;

    try {
      const chatId = [user.uid, selectedMatch.userId].sort().join('_');
      const messagesRef = collection(db, `artifacts/${appId}/chats/${chatId}/messages`);

      await addDoc(messagesRef, {
        senderId: user.uid,
        text: messageInput,
        timestamp: Timestamp.now()
      });

      setMessageInput('');
    } catch (error) {
      console.error('Send message error:', error);
    }
  };

  const startPracticeGame = () => {
    const newGame = new Chess();
    setChess(newGame);
    setGamePosition(newGame.fen());
    setGameOver(false);
    setGameResult('');
    setTimeLeft(600);
    setGameStarted(true);
  };

  const makeMove = (sourceSquare: string, targetSquare: string) => {
    try {
      const gameCopy = new Chess(chess.fen());
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q'
      });

      if (move === null) return false;

      setChess(gameCopy);
      setGamePosition(gameCopy.fen());

      if (gameCopy.isGameOver()) {
        handleGameOver(gameCopy);
        return true;
      }

      setTimeout(() => makeAIMove(gameCopy), 300);
      return true;
    } catch (error) {
      return false;
    }
  };

  const makeAIMove = (currentGame: Chess) => {
    const moves = currentGame.moves();

    if (moves.length === 0) {
      handleGameOver(currentGame);
      return;
    }

    const bestMove = minimax(currentGame, 2, -10000, 10000, true);

    if (bestMove.move) {
      currentGame.move(bestMove.move);
      setChess(new Chess(currentGame.fen()));
      setGamePosition(currentGame.fen());

      if (currentGame.isGameOver()) {
        handleGameOver(currentGame);
      }
    }
  };

  const minimax = (game: Chess, depth: number, alpha: number, beta: number, isMaximizing: boolean): { score: number; move: string | null } => {
    if (depth === 0 || game.isGameOver()) {
      return { score: evaluateBoard(game), move: null };
    }

    const moves = game.moves();
    let bestMove = null;

    if (isMaximizing) {
      let maxScore = -10000;
      for (const move of moves) {
        game.move(move);
        const score = minimax(game, depth - 1, alpha, beta, false).score;
        game.undo();

        if (score > maxScore) {
          maxScore = score;
          bestMove = move;
        }

        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
      return { score: maxScore, move: bestMove };
    } else {
      let minScore = 10000;
      for (const move of moves) {
        game.move(move);
        const score = minimax(game, depth - 1, alpha, beta, true).score;
        game.undo();

        if (score < minScore) {
          minScore = score;
          bestMove = move;
        }

        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
      return { score: minScore, move: bestMove };
    }
  };

  const evaluateBoard = (game: Chess): number => {
    const pieceValues: { [key: string]: number } = {
      p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
      P: -1, N: -3, B: -3, R: -5, Q: -9, K: 0
    };

    let score = 0;
    const board = game.board();

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const piece = board[i][j];
        if (piece) {
          score += pieceValues[piece.type] * (piece.color === 'b' ? 1 : -1);
        }
      }
    }

    if (game.isCheckmate()) {
      score = game.turn() === 'w' ? 1000 : -1000;
    } else if (game.isDraw()) {
      score = 0;
    }

    return score;
  };

  const handleGameOver = (game: Chess) => {
    let result = '';
    if (game.isCheckmate()) {
      result = game.turn() === 'w' ? 'Checkmate! You lose.' : 'Checkmate! You win!';
    } else if (game.isDraw()) {
      result = 'Draw!';
    } else if (game.isStalemate()) {
      result = 'Stalemate!';
    } else if (game.isThreefoldRepetition()) {
      result = 'Draw by repetition!';
    } else if (game.isInsufficientMaterial()) {
      result = 'Draw by insufficient material!';
    }

    endGame(result);
  };

  const endGame = (result: string) => {
    setGameOver(true);
    setGameResult(result);
    setGameStarted(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (screen === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Crown className="w-16 h-16 text-amber-400 mx-auto mb-4 animate-pulse" />
          <p className="text-white text-xl">Loading ChessMate...</p>
        </div>
      </div>
    );
  }

  if (screen === 'profile') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-xl shadow-2xl p-8 w-full max-w-md border border-slate-700">
          <div className="text-center mb-6">
            <Crown className="w-12 h-12 text-amber-400 mx-auto mb-2" />
            <h1 className="text-3xl font-bold text-white mb-2">ChessMate</h1>
            <p className="text-slate-300">Create Your Chess Profile</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Name</label>
              <input
                type="text"
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-400"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Profile Photo URL</label>
              <input
                type="text"
                value={profileForm.profilePhotoUrl}
                onChange={(e) => setProfileForm({ ...profileForm, profilePhotoUrl: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-400"
                placeholder="https://..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Chess Rating</label>
              <input
                type="number"
                value={profileForm.chessRating}
                onChange={(e) => setProfileForm({ ...profileForm, chessRating: parseInt(e.target.value) || 1500 })}
                min={1200}
                max={2500}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Strategy Philosophy (max 150 chars)</label>
              <textarea
                value={profileForm.strategyPhilosophy}
                onChange={(e) => setProfileForm({ ...profileForm, strategyPhilosophy: e.target.value.slice(0, 150) })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-400 h-24 resize-none"
                placeholder="I prefer positional play over tactical chaos..."
              />
              <p className="text-xs text-slate-400 mt-1">{profileForm.strategyPhilosophy.length}/150</p>
            </div>

            <button
              onClick={createProfile}
              className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 rounded-lg transition-colors"
            >
              Create Profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'practice') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setScreen('discovery')}
              className="flex items-center gap-2 text-white hover:text-amber-400 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>

            {gameStarted && !gameOver && (
              <div className="text-white text-xl font-bold">
                {formatTime(timeLeft)}
              </div>
            )}
          </div>

          <div className="bg-slate-800 rounded-xl shadow-2xl p-6 border border-slate-700">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-bold text-white mb-2">Practice Mate</h2>
              <p className="text-slate-300">Play against the AI</p>
            </div>

            <div className="max-w-xl mx-auto">
              <Chessboard
                position={gamePosition}
                onPieceDrop={(sourceSquare, targetSquare) => makeMove(sourceSquare, targetSquare)}
                boardWidth={Math.min(500, window.innerWidth - 100)}
                customDarkSquareStyle={{ backgroundColor: '#334155' }}
                customLightSquareStyle={{ backgroundColor: '#cbd5e1' }}
              />

              {!gameStarted && !gameOver && (
                <button
                  onClick={startPracticeGame}
                  className="w-full mt-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 rounded-lg transition-colors"
                >
                  Start Game
                </button>
              )}

              {gameOver && (
                <div className="mt-4 text-center">
                  <p className="text-xl font-bold text-white mb-4">{gameResult}</p>
                  <button
                    onClick={startPracticeGame}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-6 rounded-lg transition-colors"
                  >
                    Play Again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'chat' && selectedMatch) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex flex-col">
        <div className="bg-slate-800 border-b border-slate-700 p-4 flex items-center gap-3">
          <button
            onClick={() => {
              setScreen('matches');
              setSelectedMatch(null);
            }}
            className="text-white hover:text-amber-400 transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <img
            src={selectedMatch.profile?.profilePhotoUrl}
            alt={selectedMatch.profile?.name}
            className="w-10 h-10 rounded-full object-cover"
          />
          <div>
            <h2 className="text-white font-bold">{selectedMatch.profile?.name}</h2>
            <p className="text-slate-400 text-sm">Rating: {selectedMatch.profile?.chessRating}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.senderId === user?.uid ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs px-4 py-2 rounded-lg ${
                  msg.senderId === user?.uid
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-slate-700 text-white'
                }`}
              >
                <p>{msg.text}</p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="bg-slate-800 border-t border-slate-700 p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={sendMessage}
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 p-2 rounded-lg transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'matches') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="max-w-4xl mx-auto p-4">
          <h1 className="text-3xl font-bold text-white mb-6 text-center">Your Matches</h1>

          {matches.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No matches yet. Keep swiping!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {matches.map((match) => (
                <div
                  key={match.userId}
                  onClick={() => selectMatch(match)}
                  className="bg-slate-800 rounded-xl p-4 border border-slate-700 hover:border-amber-400 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <img
                      src={match.profile?.profilePhotoUrl}
                      alt={match.profile?.name}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-bold text-lg">{match.profile?.name}</h3>
                        {match.icebreakerCompleted && (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        )}
                      </div>
                      <p className="text-slate-400 text-sm">Rating: {match.profile?.chessRating}</p>
                      <p className="text-slate-300 text-sm mt-1">{match.profile?.strategyPhilosophy}</p>
                      {!match.icebreakerCompleted && (
                        <p className="text-amber-400 text-sm mt-2">Complete icebreaker to chat</p>
                      )}
                    </div>
                    <MessageCircle className="w-6 h-6 text-amber-400" />
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setScreen('discovery')}
            className="w-full mt-6 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 rounded-lg transition-colors"
          >
            Back to Discovery
          </button>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 p-4">
          <div className="max-w-4xl mx-auto flex justify-around">
            <button onClick={() => setScreen('discovery')} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
              <Heart className="w-6 h-6" />
              <span className="text-xs">Discover</span>
            </button>
            <button onClick={() => setScreen('matches')} className="flex flex-col items-center gap-1 text-amber-400">
              <Users className="w-6 h-6" />
              <span className="text-xs">Matches</span>
            </button>
            <button onClick={() => setScreen('practice')} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
              <Swords className="w-6 h-6" />
              <span className="text-xs">Practice</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 pb-20">
      <div className="max-w-4xl mx-auto p-4">
        <div className="text-center mb-6 pt-4">
          <Crown className="w-10 h-10 text-amber-400 mx-auto mb-2" />
          <h1 className="text-3xl font-bold text-white">ChessMate</h1>
        </div>

        {currentDiscoveryIndex < discoveryProfiles.length ? (
          <div className="max-w-md mx-auto">
            <div className="bg-slate-800 rounded-xl shadow-2xl overflow-hidden border border-slate-700">
              <img
                src={discoveryProfiles[currentDiscoveryIndex].profilePhotoUrl}
                alt={discoveryProfiles[currentDiscoveryIndex].name}
                className="w-full h-96 object-cover"
              />
              <div className="p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-2xl font-bold text-white">
                    {discoveryProfiles[currentDiscoveryIndex].name}
                  </h2>
                  <div className="bg-amber-500 text-slate-900 px-3 py-1 rounded-full font-bold text-sm">
                    {discoveryProfiles[currentDiscoveryIndex].chessRating}
                  </div>
                </div>
                <p className="text-slate-300 mb-4">
                  {discoveryProfiles[currentDiscoveryIndex].strategyPhilosophy}
                </p>

                <div className="flex gap-4 mt-6">
                  <button
                    onClick={() => handleSwipe(false)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <X className="w-6 h-6" />
                    Pass
                  </button>
                  <button
                    onClick={() => handleSwipe(true)}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Heart className="w-6 h-6" />
                    Like
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-300 text-xl mb-2">No more users nearby!</p>
            <p className="text-slate-400">Check back later for more chess enthusiasts</p>
          </div>
        )}
      </div>

      {showMatchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-8 max-w-md text-center shadow-2xl">
            <Crown className="w-16 h-16 text-slate-900 mx-auto mb-4 animate-bounce" />
            <h2 className="text-3xl font-bold text-slate-900 mb-2">It's a Mate!</h2>
            <p className="text-slate-800 text-lg">You matched with {newMatchName}!</p>
          </div>
        </div>
      )}

      {showIcebreaker && selectedMatch && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full border border-slate-700">
            <h2 className="text-2xl font-bold text-white mb-4">Chess Icebreaker</h2>
            <p className="text-slate-300 mb-4">
              If you could only play one opening for the rest of your life, what would it be?
            </p>
            <textarea
              value={icebreakerAnswer}
              onChange={(e) => setIcebreakerAnswer(e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-amber-400 h-24 resize-none mb-4"
              placeholder="Your answer..."
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowIcebreaker(false);
                  setSelectedMatch(null);
                }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitIcebreaker}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-2 rounded-lg transition-colors"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 p-4">
        <div className="max-w-4xl mx-auto flex justify-around">
          <button onClick={() => setScreen('discovery')} className="flex flex-col items-center gap-1 text-amber-400">
            <Heart className="w-6 h-6" />
            <span className="text-xs">Discover</span>
          </button>
          <button onClick={() => setScreen('matches')} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <Users className="w-6 h-6" />
            <span className="text-xs">Matches</span>
          </button>
          <button onClick={() => setScreen('practice')} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <Swords className="w-6 h-6" />
            <span className="text-xs">Practice</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
