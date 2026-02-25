/**
 * Inner Self - SillyTavern Extension
 * Gives characters in your conversations memory, goals, secrets, planning, and self-reflection
 * Based on Inner Self by LewdLeah
 * 
 * Installation: Place this file in SillyTavern's extensions folder
 */

(function() {
    // Extension info
    const extension = {
        name: 'Inner Self',
        id: 'inner-self',
        version: '1.0.0',
        author: 'LewdLeah (ported by Hoang Anh)',
        description: 'Gives characters minds of their own - memory, goals, secrets, planning, and self-reflection'
    };

    // Settings
    const defaultSettings = {
        enabled: true,
        thoughtFormationChance: 60,
        debugMode: false,
        characters: '', // Comma-separated list of character names
        recentStoryPercent: 30,
        visualIndicator: '🎭',
        jsonFormat: false,
        thoughtChanceHalfForInput: true
    };

    let settings = { ...defaultSettings };
    let state = {
        agents: {},
        label: 0,
        ops: 0,
        lastHash: ''
    };

    // Character brain structure
    class CharacterBrain {
        constructor(name) {
            this.name = name;
            this.thoughts = [];
            this.goals = [];
            this.secrets = [];
            this.memories = [];
            this.opinions = {};
            this.lastActive = Date.now();
        }

        addThought(thought) {
            this.thoughts.push({
                text: thought,
                timestamp: Date.now()
            });
            // Keep only last 20 thoughts
            if (this.thoughts.length > 20) {
                this.thoughts.shift();
            }
        }

        addMemory(memory) {
            this.memories.push({
                text: memory,
                timestamp: Date.now()
            });
            // Keep last 50 memories
            if (this.memories.length > 50) {
                this.compressMemories();
            }
        }

        compressMemories() {
            // Summarize old memories
            if (this.memories.length > 30) {
                const summary = this.memories.slice(-10).map(m => m.text).join(' ');
                this.memories = this.memories.slice(-20);
                this.memories.unshift({
                    text: `[Compressed Memory] ${summary.substring(0, 200)}...`,
                    timestamp: Date.now(),
                    compressed: true
                });
            }
        }

        addGoal(goal) {
            this.goals.push({
                text: goal,
                timestamp: Date.now(),
                status: 'active'
            });
        }

        addSecret(secret) {
            this.secrets.push({
                text: secret,
                timestamp: Date.now()
            });
        }

        updateOpinion(key, value) {
            this.opinions[key] = value;
        }

        getContext(maxLength = 500) {
            let context = [];
            
            // Recent thoughts
            if (this.thoughts.length > 0) {
                context.push(`[Inner Thoughts] ${this.thoughts.slice(-3).map(t => t.text).join(' | ')}`);
            }
            
            // Goals
            const activeGoals = this.goals.filter(g => g.status === 'active');
            if (activeGoals.length > 0) {
                context.push(`[Goals] ${activeGoals.map(g => g.text).join(' | ')}`);
            }
            
            // Secrets (only some)
            if (this.secrets.length > 0) {
                context.push(`[Secrets] ${this.secrets.slice(-2).map(s => s.text).join(' | ')}`);
            }
            
            return context.join('\n');
        }
    }

    // Get or create character brain
    function getBrain(characterName) {
        if (!state.agents[characterName]) {
            state.agents[characterName] = new CharacterBrain(characterName);
            console.log(`[Inner Self] Created brain for: ${characterName}`);
        }
        state.agents[characterName].lastActive = Date.now();
        return state.agents[characterName];
    }

    // Extract character names from recent messages
    function extractCharacterNames(messages, lookBack = 5) {
        const names = new Set();
        const recentMessages = messages.slice(-lookBack);
        
        // Get character names from chat characters
        if (typeof getChatCharacters === 'function') {
            const chars = getChatCharacters();
            chars.forEach(c => {
                if (c.name) names.add(c.name);
            });
        }
        
        // Also check for names in messages
        recentMessages.forEach(msg => {
            // Look for character names in message metadata
            if (msg.name) names.add(msg.name);
        });
        
        return Array.from(names);
    }

    // Generate thought based on context
    async function generateThought(brain, message, characterName) {
        const prompt = `You are the inner mind of ${characterName}. 
Based on what just happened in the conversation, generate a brief inner thought (1-2 sentences max).

Recent context: ${message.substring(0, 200)}

Generate a private thought that reveals ${characterName}'s true feelings, opinions, or plans. Be subtle and in-character.`;

        try {
            // Use SillyTavern's chat completion
            const response = await fetch('/api_chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    model: 'original', // Use default model
                    max_tokens: 100
                })
            });
            
            const data = await response.json();
            if (data.choices && data.choices[0]) {
                const thought = data.choices[0].message.content.trim();
                brain.addThought(thought);
                return thought;
            }
        } catch (e) {
            console.error('[Inner Self] Error generating thought:', e);
        }
        return null;
    }

    // Main process function
    async function processMessage(event) {
        if (!settings.enabled) return;
        
        const messages = event.messages || [];
        if (messages.length < 2) return;
        
        const lastMessage = messages[messages.length - 1];
        const characterName = lastMessage.name;
        
        if (!characterName || characterName === 'You') return;
        
        // Check if this character should have a brain
        const configuredChars = settings.characters.split(',').map(s => s.trim()).filter(s => s);
        if (configuredChars.length > 0 && !configuredChars.includes(characterName)) {
            return; // Not a configured character
        }
        
        const brain = getBrain(characterName);
        
        // Thought formation chance
        let chance = settings.thoughtFormationChance;
        if (settings.thoughtChanceHalfForInput && lastMessage.is_user) {
            chance = chance / 2;
        }
        
        if (Math.random() * 100 < chance) {
            const thought = await generateThought(brain, lastMessage.text || '', characterName);
            if (thought && settings.debugMode) {
                console.log(`[Inner Self] ${characterName}: ${thought}`);
            }
        }
        
        // Add to memory
        brain.addMemory(lastMessage.text || '');
    }

    // Inject character context
    function getInnerSelfContext(characterName) {
        const brain = state.agents[characterName];
        if (!brain) return '';
        
        return brain.getContext();
    }

    // Extension initialization
    function init() {
        console.log('[Inner Self] Extension loaded');
        
        // Load settings
        const savedSettings = localStorage.getItem('innerself_settings');
        if (savedSettings) {
            try {
                settings = { ...defaultSettings, ...JSON.parse(savedSettings) };
            } catch (e) {
                console.error('[Inner Self] Error loading settings:', e);
            }
        }
        
        // Load state
        const savedState = localStorage.getItem('innerself_state');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                // Recreate brain objects
                state.agents = {};
                for (const [name, data] of Object.entries(parsed.agents || {})) {
                    const brain = new CharacterBrain(name);
                    brain.thoughts = data.thoughts || [];
                    brain.goals = data.goals || [];
                    brain.secrets = data.secrets || [];
                    brain.memories = data.memories || [];
                    brain.opinions = data.opinions || {};
                    state.agents[name] = brain;
                }
                state.label = parsed.label || 0;
                state.ops = parsed.ops || 0;
            } catch (e) {
                console.error('[Inner Self] Error loading state:', e);
            }
        }
        
        // Register event handlers
        if (typeof eventBus !== 'undefined') {
            eventBus.on('chatevent', processMessage);
        }
        
        // Create UI
        createSettingsPanel();
    }

    // Save state
    function saveState() {
        const stateToSave = {
            agents: {},
            label: state.label,
            ops: state.ops
        };
        
        for (const [name, brain] of Object.entries(state.agents)) {
            stateToSave.agents[name] = {
                thoughts: brain.thoughts,
                goals: brain.goals,
                secrets: brain.secrets,
                memories: brain.memories,
                opinions: brain.opinions
            };
        }
        
        localStorage.setItem('innerself_state', JSON.stringify(stateToSave));
    }

    // Settings panel
    function createSettingsPanel() {
        const panel = document.createElement('div');
        panel.id = 'innerself-panel';
        panel.innerHTML = `
            <style>
                #innerself-panel {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    width: 300px;
                    background: #1e1e2e;
                    border: 1px solid #444;
                    border-radius: 8px;
                    padding: 15px;
                    z-index: 1000;
                    color: #fff;
                    font-family: system-ui;
                }
                #innerself-panel h3 {
                    margin: 0 0 10px 0;
                    font-size: 16px;
                }
                #innerself-panel label {
                    display: block;
                    margin: 8px 0 4px;
                    font-size: 12px;
                    color: #aaa;
                }
                #innerself-panel input, #innerself-panel textarea {
                    width: 100%;
                    background: #2a2a3e;
                    border: 1px solid #444;
                    color: #fff;
                    padding: 6px;
                    border-radius: 4px;
                }
                #innerself-panel button {
                    background: #4a4a6a;
                    border: none;
                    color: #fff;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-top: 10px;
                }
                #innerself-panel button:hover {
                    background: #5a5a7a;
                }
                #innerself-toggle {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    z-index: 999;
                }
            </style>
            <h3>🎭 Inner Self</h3>
            <label>
                <input type="checkbox" id="innerself-enabled" ${settings.enabled ? 'checked' : ''}>
                Enable Inner Self
            </label>
            <label>Character Names (comma-separated)</label>
            <input type="text" id="innerself-chars" value="${settings.characters}" placeholder="Alice, Bob, Carol">
            <label>Thought Formation Chance (%)</label>
            <input type="number" id="innerself-chance" value="${settings.thoughtFormationChance}" min="0" max="100">
            <label>
                <input type="checkbox" id="innerself-debug" ${settings.debugMode ? 'checked' : ''}>
                Debug Mode
            </label>
            <button id="innerself-save">Save Settings</button>
            <hr style="border-color: #444; margin: 15px 0;">
            <button id="innerself-view-brains">View Character Brains</button>
        `;
        
        document.body.appendChild(panel);
        
        // Event listeners
        document.getElementById('innerself-save').addEventListener('click', () => {
            settings.enabled = document.getElementById('innerself-enabled').checked;
            settings.characters = document.getElementById('innerself-chars').value;
            settings.thoughtFormationChance = parseInt(document.getElementById('innerself-chance').value);
            settings.debugMode = document.getElementById('innerself-debug').checked;
            
            localStorage.setItem('innerself_settings', JSON.stringify(settings));
            alert('Settings saved!');
        });
        
        document.getElementById('innerself-view-brains').addEventListener('click', () => {
            let info = '🎭 Character Brains\n\n';
            for (const [name, brain] of Object.entries(state.agents)) {
                info += `=== ${name} ===\n`;
                info += `Thoughts: ${brain.thoughts.length}\n`;
                info += `Goals: ${brain.goals.length}\n`;
                info += `Secrets: ${brain.secrets.length}\n`;
                info += `Memories: ${brain.memories.length}\n`;
                if (brain.thoughts.length > 0) {
                    info += `Latest: "${brain.thoughts[brain.thoughts.length-1].text}"\n`;
                }
                info += '\n';
            }
            alert(info || 'No brains yet. Start chatting!');
        });
        
        // Auto-save state periodically
        setInterval(saveState, 30000);
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for external use
    window.InnerSelf = {
        getContext: getInnerSelfContext,
        getBrain: getBrain,
        getState: () => state
    };

})();
