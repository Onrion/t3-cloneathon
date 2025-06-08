"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Bot,
  User
} from "lucide-react";
import { cn } from "@/lib/utils";

// --- Firebase Integration ---
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  addDoc,
  collection,
  query,
  onSnapshot,
  orderBy,
  Timestamp,
  deleteDoc
} from 'firebase/firestore';

// --- Inlined ThemeProvider to fix path resolution issue ---
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

// --- MOCK Firebase Config ---
// This should be replaced with your actual Firebase config.
// The __firebase_config global will be provided in the execution environment.
const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? JSON.parse(__firebase_config)
  : {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  };

// --- Firebase App Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Types ---
interface Message {
  id: string;
  text: string;
  role: 'user' | 'model';
  timestamp: Timestamp;
}

interface Chat {
  id: string;
  title: string;
  createdAt: Timestamp;
}

// --- Main App Component ---
export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="t3-chat-clone-theme">
      <SidebarProvider defaultOpen>
        <ChatApp />
      </SidebarProvider>
    </ThemeProvider>
  );
}

// --- Chat Application Component ---
function ChatApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const appId = typeof __app_id !== 'undefined' ? __app_id : 't3-chat-clone';

  // --- Authentication Effect ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
      } else {
        await signInAnonymously(auth);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleNewChat = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    const chatsCollectionPath = `/artifacts/${appId}/users/${user.uid}/chats`;
    try {
      const newChat = {
        title: "New Chat",
        createdAt: Timestamp.now(),
      };
      const docRef = await addDoc(collection(db, chatsCollectionPath), newChat);
      setActiveChatId(docRef.id);
    } catch (error) {
      console.error("Error creating new chat:", error);
    } finally {
      setIsLoading(false);
    }
  }, [user, appId]);


  // --- Fetch Chats Effect ---
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const chatsCollectionPath = `/artifacts/${appId}/users/${user.uid}/chats`;
    const q = query(collection(db, chatsCollectionPath), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedChats: Chat[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Chat));
      setChats(fetchedChats);
      
      if (!activeChatId && fetchedChats.length > 0) {
        setActiveChatId(fetchedChats[0].id);
      } else if (snapshot.docs.length === 0) {
        // If there are no chats, create a new one.
        handleNewChat();
      }
    });

    return () => unsubscribe();
  }, [user, appId, isAuthReady, handleNewChat, activeChatId]);

  // --- Fetch Messages Effect ---
  useEffect(() => {
    if (!activeChatId || !user) {
        setMessages([]);
        return;
    };

    const messagesCollectionPath = `/artifacts/${appId}/users/${user.uid}/chats/${activeChatId}/messages`;
    const q = query(collection(db, messagesCollectionPath), orderBy("timestamp", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMessages: Message[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Message));
      setMessages(fetchedMessages);
    });

    return () => unsubscribe();
  }, [activeChatId, user, appId]);


  // --- Helper Functions ---
  const handleDeleteChat = async (chatId: string) => {
      if (!user) return;
      try {
          const chatDocPath = `/artifacts/${appId}/users/${user.uid}/chats/${chatId}`;
          // In a real app, deleting subcollections requires a Cloud Function.
          // For this demo, we'll just delete the chat doc.
          await deleteDoc(doc(db, chatDocPath));
          
          if(activeChatId === chatId) {
            const remainingChats = chats.filter(c => c.id !== chatId);
            setActiveChatId(remainingChats.length > 0 ? remainingChats[0].id : null);
          }
      } catch (error) {
          console.error("Error deleting chat:", error);
      }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !user || !activeChatId || isLoading) return;

    const userInput = input.trim();
    setInput("");
    setIsLoading(true);

    const messagesCollectionPath = `/artifacts/${appId}/users/${user.uid}/chats/${activeChatId}/messages`;

    // 1. Add user message to Firestore
    const userMessage: Omit<Message, 'id'> = {
      text: userInput,
      role: 'user',
      timestamp: Timestamp.now(),
    };
    await addDoc(collection(db, messagesCollectionPath), userMessage);

    // 2. Call Gemini API
    try {
        const chatHistory = messages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
        }));
        chatHistory.push({ role: "user", parts: [{ text: userInput }] });

        const payload = { contents: chatHistory };
        const apiKey = ""; // Leave empty for Gemini Flash
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API call failed with status: ${response.status}`);
        }

        const result = await response.json();
        
        let modelResponse = "Sorry, I couldn't generate a response.";
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            modelResponse = result.candidates[0].content.parts[0].text;
        }

        // 3. Add model response to Firestore
        const modelMessage: Omit<Message, 'id'> = {
            text: modelResponse,
            role: 'model',
            timestamp: Timestamp.now(),
        };
        await addDoc(collection(db, messagesCollectionPath), modelMessage);

    } catch (error) {
        console.error("Error calling Gemini API or saving message:", error);
        const errorMessage: Omit<Message, 'id'> = {
            text: `Error: ${error instanceof Error ? error.message : "An unknown error occurred."}`,
            role: 'model',
            timestamp: Timestamp.now(),
        };
        await addDoc(collection(db, messagesCollectionPath), errorMessage);
    } finally {
        setIsLoading(false);
    }
  };


  if (!isAuthReady) {
      return <div className="flex items-center justify-center h-screen w-full bg-background text-foreground">Loading...</div>
  }

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar>
        <SidebarHeader>
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={handleNewChat} disabled={isLoading}>
            <Plus className="size-4" />
            <span>New Chat</span>
          </Button>
        </SidebarHeader>

        <SidebarContent className="p-2">
            <ScrollArea className="h-full">
                <SidebarMenu>
                    {chats.map((chat) => (
                    <SidebarMenuItem key={chat.id}>
                        <SidebarMenuButton
                        onClick={() => setActiveChatId(chat.id)}
                        isActive={activeChatId === chat.id}
                        className="w-full justify-start gap-2"
                        >
                        <MessageSquare className="size-4" />
                        <span className="truncate flex-1">{chat.title}</span>
                        </SidebarMenuButton>
                        <Button variant="ghost" size="icon" className="absolute right-1 top-1.5 h-7 w-7" onClick={() => handleDeleteChat(chat.id)}>
                            <Trash2 className="size-4" />
                        </Button>
                    </SidebarMenuItem>
                    ))}
                </SidebarMenu>
            </ScrollArea>
        </SidebarContent>

        <SidebarFooter>
            {user && (
                 <div className="flex items-center gap-2 p-2 border-t border-border">
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={user.photoURL || undefined} />
                        <AvatarFallback><User /></AvatarFallback>
                    </Avatar>
                    <p className="text-sm text-muted-foreground truncate">
                        {user.isAnonymous ? "Anonymous User" : user.uid.substring(0,8)}
                    </p>
                </div>
            )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="flex flex-col">
        <div className="flex-1 overflow-hidden">
             <ScrollArea className="h-full">
                <div className="p-4 md:p-6" ref={(el) => el?.scrollTo(0, el.scrollHeight)}>
                {messages.length === 0 && !isLoading && (
                     <div className="flex h-[calc(100vh-150px)] items-center justify-center">
                        <div className="text-center">
                            <Bot className="mx-auto h-12 w-12 text-gray-400" />
                            <h3 className="mt-2 text-sm font-medium text-foreground">T3.chat Clone</h3>
                            <p className="mt-1 text-sm text-muted-foreground">Start a conversation by typing below.</p>
                         </div>
                    </div>
                )}
                {messages.map(msg => <ChatMessage key={msg.id} message={msg} />)}
                {isLoading && messages.length > 0 && messages[messages.length-1]?.role === 'user' && <LoadingChatMessage />}
                 </div>
            </ScrollArea>
        </div>
        <ChatInput
            input={input}
            setInput={setInput}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
        />
      </SidebarInset>
    </div>
  );
}


// --- Sub-Components ---

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn("flex items-start gap-3 my-4", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <Avatar className="h-8 w-8">
           <AvatarFallback><Bot /></AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          "max-w-xl rounded-lg p-3 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
      {isUser && (
         <Avatar className="h-8 w-8">
            <AvatarFallback><User /></AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

function LoadingChatMessage() {
    return (
        <div className="flex items-start gap-3 my-4 justify-start">
            <Avatar className="h-8 w-8">
               <AvatarFallback><Bot /></AvatarFallback>
            </Avatar>
            <div className="bg-muted rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 bg-foreground rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="h-2 w-2 bg-foreground rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="h-2 w-2 bg-foreground rounded-full animate-bounce"></div>
                </div>
            </div>
        </div>
    );
}


function ChatInput({ input, setInput, onSendMessage, isLoading }: {
    input: string;
    setInput: (value: string) => void;
    onSendMessage: () => void;
    isLoading: boolean;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSendMessage();
        }
    };
    
    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const scrollHeight = textareaRef.current.scrollHeight;
            textareaRef.current.style.height = `${scrollHeight}px`;
        }
    }, [input]);

    return (
    <div className="bg-background p-4 border-t border-border">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="w-full resize-none pr-20 min-h-[40px] max-h-[200px]"
          rows={1}
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="icon"
          className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
          onClick={onSendMessage}
          disabled={isLoading || !input.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

