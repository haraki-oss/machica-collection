// Machica Clip - Main Application Logic

// === Supabase Configuration ===
const SUPABASE_URL = 'https://izpqclmzyiommzyovcuu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2srAPKaBOxzUZjtL92Nnug_Rp1ERO5s';

// Supabaseクライアントの初期化 (CDN版)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    // === DOM Elements ===
    const views = {
        login: document.getElementById('view-login'),
        mypage: document.getElementById('view-mypage'),
        add: document.getElementById('view-add'),
        listDetail: document.getElementById('view-list-detail'),
        cardDetail: document.getElementById('view-card-detail')
    };

    // Machica Collection は同じデプロイ配下にあるので相対パスで参照する
    // （`/clip/...` にいるので親ディレクトリ `..` が Collection ルート）
    const COLLECTION_BASE_URL = '../';
    
    const navLoginBtn = document.getElementById('nav-login-btn');
    const navUserMenu = document.getElementById('nav-user-menu');
    const logoBtn = document.getElementById('logo-btn');
    const profileName = document.getElementById('profile-name');
    const profileId = document.getElementById('profile-id');
    
    // Login Elements
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const loginSubmitBtn = document.getElementById('login-submit-btn');
    const goRegisterBtn = document.getElementById('go-register-btn');

    // Add Card View Elements
    const addCardTitle = document.getElementById('add-card-title');
    const addCardImage = document.getElementById('add-card-image');
    const addCardPlaceholder = document.getElementById('add-card-placeholder');
    const addSelectList = document.getElementById('add-select-list');
    const addCancelBtn = document.getElementById('add-cancel-btn');
    const addConfirmBtn = document.getElementById('add-confirm-btn');

    // === State ===
    let currentUser = null; 
    let currentCardData = null; // URLから取得した追加予定のカード情報
    
    // === Authentication Logic ===
    
    // セッションの確認（ページ読み込み時）
    async function checkSession() {
        const { data, error } = await supabaseClient.auth.getSession();
        if (data.session) {
            currentUser = data.session.user;
            await loadUserData();
        } else {
            currentUser = null;
        }
        handleRoute();
    }

    // Auth状態の変更を監視
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (session) {
                currentUser = session.user;
                await loadUserData();
                handleRoute();
            }
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            handleRoute();
        }
    });

    async function loadUserData() {
        if (!currentUser) return;
        
        // メアドから適当な名前を生成して表示
        const emailPrefix = currentUser.email.split('@')[0];
        profileName.textContent = emailPrefix;
        profileId.textContent = `@${emailPrefix}`;
        
        // ユーザーのマイリスト一覧を取得
        await fetchUserLists();
    }

    // === Routing Logic ===
    function handleRoute() {
        try {
            _handleRouteInner();
        } catch (e) {
            // ルーティング中の例外で画面が完全に空になるのを防ぎ、
            // 何が起きたか DevTools コンソールに残す
            console.error('[clip] Routing failed:', e);
            try {
                Object.values(views).forEach(view => view && view.classList.add('hidden'));
                showView(currentUser ? 'mypage' : 'login');
            } catch (_) { /* noop */ }
        }
    }

    function _handleRouteInner() {
        const hash = window.location.hash;

        // Hide all views（要素が見つからないケースに備えて null チェック）
        Object.values(views).forEach(view => view && view.classList.add('hidden'));

        if (hash.startsWith('#add')) {
            // 例: #add?card_id=123&title=カード名&image=画像URL
            if (!currentUser) {
                // 未ログインなら、遷移先のURLを記録してログイン画面へ
                sessionStorage.setItem('pending_add_url', hash);
                showView('login');
            } else {
                showAddCardView(hash);
            }
        } else if (hash === '#mypage' || hash === '') {
            if (!currentUser) {
                showView('login');
            } else {
                showView('mypage');
            }
        } else if (hash.startsWith('#list')) {
            if (!currentUser) {
                showView('login');
            } else {
                showListDetailView(hash);
            }
        } else if (hash.startsWith('#card')) {
            // 例: #card?id=<collected_card_id>
            if (!currentUser) {
                showView('login');
            } else {
                showCardDetailView(hash);
            }
        } else if (hash === '#login') {
            showView('login');
        } else {
            // Default
            showView(currentUser ? 'mypage' : 'login');
        }

        updateNav();
    }

    function showView(viewName) {
        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
        }
    }

    function updateNav() {
        if (currentUser) {
            navLoginBtn.classList.add('hidden');
            navUserMenu.classList.remove('hidden');
            navUserMenu.classList.add('flex');
        } else {
            navUserMenu.classList.add('hidden');
            navUserMenu.classList.remove('flex');
            navLoginBtn.classList.remove('hidden');
        }
    }

    // === View Specific Logic ===
    
    // Login & Register
    loginSubmitBtn.addEventListener('click', async () => {
        const email = loginEmailInput.value;
        const password = loginPasswordInput.value;
        
        if (!email || !password) {
            alert('メールアドレスとパスワードを入力してください');
            return;
        }

        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = '処理中...';

        try {
            // サインイン（ログイン）を試みる
            console.log('ログイン試行中:', email);
            let { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                console.error('ログイン失敗:', error.message);
                // ログイン失敗時は、新規登録を試みる（簡易的なUX）
                if (error.message.includes('Invalid login credentials')) {
                    const confirmRegister = confirm('アカウントが見つかりません。この内容で新規登録しますか？');
                    if (confirmRegister) {
                        console.log('新規登録試行中...');
                        const { data: regData, error: regError } = await supabaseClient.auth.signUp({
                            email: email,
                            password: password,
                        });
                        
                        if (regError) {
                            console.error('新規登録失敗:', regError.message);
                            throw regError;
                        }
                        
                        if (regData.user && regData.session === null) {
                            alert('登録の案内を送信しました。メールを確認するか、Supabaseの設定で「Confirm Email」をオフにしてください。');
                        } else {
                            alert('登録成功しました！');
                        }
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }

            console.log('ログイン成功:', data.user);
            // 成功時の遷移
            const pendingAction = sessionStorage.getItem('pending_add_url');
            if (pendingAction) {
                sessionStorage.removeItem('pending_add_url');
                window.location.hash = pendingAction;
            } else {
                window.location.hash = '#mypage';
            }

        } catch (error) {
            alert('エラーが発生しました: ' + error.message);
        } finally {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = 'ログイン';
        }
    });

    goRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        alert('上のフォームにメールアドレスとパスワードを入力して「ログイン」を押すと、アカウントが無い場合は自動で新規登録の案内が出ます。');
    });

    // ログアウト処理（メニューのアイコンクリック時）
    navUserMenu.addEventListener('click', async () => {
        if (confirm('ログアウトしますか？')) {
            await supabaseClient.auth.signOut();
            window.location.hash = '#login';
        }
    });

    // Data Fetching: Lists
    // checkSession と onAuthStateChange の両方から fetchUserLists が同時に走り、
    // どちらも data.length === 0 を観測してデフォルトリストを二重に作成してしまうことがあるので
    // インフライトを管理する。
    let _listsFetchInFlight = null;
    let _defaultListPending = false;

    function fetchUserLists() {
        if (!currentUser) return Promise.resolve();
        if (_listsFetchInFlight) return _listsFetchInFlight;
        _listsFetchInFlight = (async () => {
            const { data, error } = await supabaseClient
                .from('lists')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('リストの取得エラー:', error);
                return;
            }

            renderLists(data);
            updateAddCardSelect(data);

            if ((!data || data.length === 0) && !_defaultListPending) {
                _defaultListPending = true;
                try {
                    await createDefaultList();
                } finally {
                    _defaultListPending = false;
                }
            }
        })();
        try {
            return _listsFetchInFlight;
        } finally {
            // 完了後にフラグをクリア
            _listsFetchInFlight.finally(() => { _listsFetchInFlight = null; });
        }
    }

    async function createDefaultList() {
        // 念のため再チェック：既に何か入っていたら作らない
        const { data: existing } = await supabaseClient
            .from('lists')
            .select('id')
            .eq('user_id', currentUser.id)
            .limit(1);
        if (existing && existing.length > 0) {
            // 既にある場合はリスト UI だけ更新
            await fetchUserLists();
            return;
        }

        const { data, error } = await supabaseClient
            .from('lists')
            .insert([{ user_id: currentUser.id, name: 'マイコレクション' }])
            .select();

        if (!error && data) {
            // 作成後の再取得：renderLists + updateAddCardSelect を更新するため
            const { data: lists } = await supabaseClient
                .from('lists')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
            if (lists) {
                renderLists(lists);
                updateAddCardSelect(lists);
            }
        }
    }

    function renderLists(lists) {
        const container = document.getElementById('lists-container');
        container.innerHTML = ''; // Clear
        
        if (!lists || lists.length === 0) return;

        lists.forEach(list => {
            const el = document.createElement('div');
            el.className = 'bg-white p-4 rounded-3xl shadow-sm aspect-video flex flex-col items-center justify-center cursor-pointer hover:shadow-md transition-shadow relative overflow-hidden group';
            el.innerHTML = `
                <div class="absolute inset-0 bg-ciel-50 opacity-50"></div>
                <span class="relative font-bold text-gray-700 text-sm mb-1">${list.name}</span>
                <span class="relative text-xs text-gray-400">アイテムを見る</span>
            `;
            el.addEventListener('click', () => {
                window.location.hash = `#list?id=${list.id}`;
            });
            container.appendChild(el);
        });
    }

    function updateAddCardSelect(lists) {
        addSelectList.innerHTML = '<option value="">保存先リストを選択...</option>';
        if (lists) {
            lists.forEach(list => {
                const option = document.createElement('option');
                option.value = list.id;
                option.textContent = list.name;
                addSelectList.appendChild(option);
            });
        }
    }

    // リスト作成ボタン
    document.getElementById('create-list-btn').addEventListener('click', async () => {
        const name = prompt('新しいリストの名前を入力してください');
        if (name && name.trim() !== '') {
            const { error } = await supabaseClient
                .from('lists')
                .insert([{ user_id: currentUser.id, name: name.trim() }]);
            
            if (error) {
                alert('リストの作成に失敗しました');
            } else {
                fetchUserLists();
            }
        }
    });

    // Add Card View
    function showAddCardView(hashUrl) {
        showView('add');

        // Parse URL parameters from hash (e.g. #add?card_id=1&title=xxx&image=url)
        const parts = hashUrl.split('?');
        if (parts.length > 1) {
            const params = new URLSearchParams(parts[1]);
            // URLSearchParams は既にデコード済みなので、二重 decodeURIComponent は不要
            // （二重デコードすると URL に偶々残った "%" 文字で URIError を投げて画面が真っ白になる）
            currentCardData = {
                id: params.get('card_id'),
                title: params.get('title') || 'タイトルなし',
                image: params.get('image') || ''
            };

            addCardTitle.textContent = currentCardData.title;

            if (currentCardData.image) {
                addCardImage.src = currentCardData.image;
                addCardImage.classList.remove('hidden');
                addCardPlaceholder.classList.add('hidden');
            } else {
                addCardImage.classList.add('hidden');
                addCardPlaceholder.classList.remove('hidden');
            }
        }

        // リスト一覧が読み込まれていなければ読み込む
        if (addSelectList.options.length <= 1) {
            fetchUserLists();
        }
    }

    // Add Card Actions
    addCancelBtn.addEventListener('click', () => {
        // 本来は window.history.back() などで元のサイトに戻る
        window.location.hash = '#mypage';
    });
    
    addConfirmBtn.addEventListener('click', async () => {
        if (!currentCardData || !currentCardData.id) {
            alert('カード情報が不正です。');
            return;
        }

        const listId = addSelectList.value;
        if (!listId) {
            alert('保存先のリストを選択してください。');
            return;
        }

        addConfirmBtn.disabled = true;
        addConfirmBtn.textContent = '保存中...';

        try {
            // Supabaseにデータを保存
            const { error } = await supabaseClient
                .from('collected_cards')
                .insert([{
                    user_id: currentUser.id,
                    list_id: listId,
                    original_card_id: currentCardData.id,
                    title: currentCardData.title,
                    image_url: currentCardData.image || null
                }]);

            if (error) throw error;

            // 成功UI
            addConfirmBtn.textContent = '保存しました！';
            addConfirmBtn.classList.replace('bg-ciel-400', 'bg-green-500');
            addConfirmBtn.classList.replace('hover:bg-ciel-500', 'hover:bg-green-600');
            
            // 1.5秒後にマイページへ（クリップが反映されたリストを見せる）
            setTimeout(() => {
                window.location.hash = `#list?id=${listId}`;

                // リセット
                addConfirmBtn.disabled = false;
                addConfirmBtn.textContent = '保存する';
                addConfirmBtn.classList.replace('bg-green-500', 'bg-ciel-400');
                addConfirmBtn.classList.replace('hover:bg-green-600', 'hover:bg-ciel-500');
            }, 1500);

        } catch (error) {
            alert('保存に失敗しました: ' + error.message);
            addConfirmBtn.disabled = false;
            addConfirmBtn.textContent = '保存する';
        }
    });

    // List Detail View
    let currentListId = null;
    let currentListName = null;

    async function showListDetailView(hashUrl) {
        showView('listDetail');

        const parts = hashUrl.split('?');
        currentListId = null;
        currentListName = null;
        if (parts.length > 1) {
            const params = new URLSearchParams(parts[1]);
            const listId = params.get('id');
            if (listId) {
                currentListId = listId;
                fetchListCards(listId);
            }
        }
    }

    async function fetchListCards(listId) {
        // 1. リスト情報の取得（タイトル表示用）
        const { data: listData } = await supabaseClient
            .from('lists')
            .select('name')
            .eq('id', listId)
            .single();
        
        if (listData) {
            document.getElementById('list-detail-title').textContent = listData.name;
            currentListName = listData.name;
        }

        // 2. カード情報の取得
        const { data, error } = await supabaseClient
            .from('collected_cards')
            .select('*')
            .eq('list_id', listId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('カード取得エラー:', error);
            return;
        }

        renderListCards(data);
    }

    function renderListCards(cards) {
        const container = document.getElementById('list-cards-container');
        const emptyState = document.getElementById('list-cards-empty');
        container.innerHTML = '';
        
        if (!cards || cards.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }
        
        emptyState.classList.add('hidden');
        cards.forEach(card => {
            const el = document.createElement('div');
            el.className = 'bg-white rounded-2xl overflow-hidden shadow-sm flex flex-col group transition-all hover:shadow-md cursor-pointer';
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.innerHTML = `
                <div class="aspect-[3/4] bg-gray-100 overflow-hidden">
                    <img src="${card.image_url}" alt="${escapeAttr(card.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform">
                </div>
                <div class="p-3">
                    <h4 class="text-sm font-bold text-gray-700 truncate">${escapeHtml(card.title)}</h4>
                    <p class="text-[10px] text-gray-400 mt-1">${new Date(card.created_at).toLocaleDateString()}</p>
                </div>
            `;
            const goDetail = () => { window.location.hash = `#card?id=${card.id}`; };
            el.addEventListener('click', goDetail);
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goDetail(); }
            });
            container.appendChild(el);
        });
    }

    // ── HTML エスケープ ─────────────────────────────────
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s); }

    // List Detail Back Button
    document.getElementById('list-detail-back-btn').addEventListener('click', () => {
        window.location.hash = '#mypage';
    });

    // ── リスト編集（リネーム） ─────────────────────
    document.getElementById('list-detail-edit-btn').addEventListener('click', async () => {
        if (!currentListId) return;
        const newName = prompt('新しいリスト名を入力してください', currentListName || '');
        if (newName == null) return; // キャンセル
        const trimmed = newName.trim();
        if (!trimmed) {
            alert('リスト名は空にできません。');
            return;
        }
        if (trimmed === currentListName) return; // 変更なし

        const { error } = await supabaseClient
            .from('lists')
            .update({ name: trimmed })
            .eq('id', currentListId);

        if (error) {
            alert('リスト名の更新に失敗しました: ' + error.message);
            return;
        }

        currentListName = trimmed;
        document.getElementById('list-detail-title').textContent = trimmed;
    });

    // ── リスト削除（中のクリップごと） ─────────────
    document.getElementById('list-detail-delete-btn').addEventListener('click', async () => {
        if (!currentListId) return;

        // リスト内のクリップ数を表示してから確認
        const { count } = await supabaseClient
            .from('collected_cards')
            .select('id', { count: 'exact', head: true })
            .eq('list_id', currentListId);

        const itemNote = (count && count > 0)
            ? `このリストに含まれる ${count} 件のクリップも削除されます。`
            : '';
        const ok = confirm(`リスト「${currentListName || ''}」を削除しますか？\n${itemNote}\nこの操作は取り消せません。`);
        if (!ok) return;

        const btn = document.getElementById('list-detail-delete-btn');
        btn.disabled = true;

        // 1. リスト内のクリップを先に削除（外部キー / RLS で list が消えると参照不整合になり得るため）
        const { error: cardsErr } = await supabaseClient
            .from('collected_cards')
            .delete()
            .eq('list_id', currentListId);

        if (cardsErr) {
            alert('クリップの削除に失敗しました: ' + cardsErr.message);
            btn.disabled = false;
            return;
        }

        // 2. リスト本体を削除
        const { error: listErr } = await supabaseClient
            .from('lists')
            .delete()
            .eq('id', currentListId);

        if (listErr) {
            alert('リストの削除に失敗しました: ' + listErr.message);
            btn.disabled = false;
            return;
        }

        const deletedId = currentListId;
        currentListId = null;
        currentListName = null;
        // マイページへ戻し、リスト一覧を再取得
        window.location.hash = '#mypage';
        await fetchUserLists();
        btn.disabled = false;
    });

    // ============================================================
    //  カード詳細ビュー（Phase 3）
    // ============================================================
    let currentClip = null; // { id, list_id, original_card_id, title, image_url, created_at }

    async function showCardDetailView(hashUrl) {
        showView('cardDetail');
        resetCardDetailUI();

        const parts = hashUrl.split('?');
        if (parts.length < 2) { showCardDetailError(); return; }
        const params = new URLSearchParams(parts[1]);
        const collectedId = params.get('id');
        if (!collectedId) { showCardDetailError(); return; }

        document.getElementById('card-detail-loading').classList.remove('hidden');

        // 1. クリップを取得（同時にリスト名も）
        const { data: clip, error: clipErr } = await supabaseClient
            .from('collected_cards')
            .select('*, lists ( name )')
            .eq('id', collectedId)
            .single();

        document.getElementById('card-detail-loading').classList.add('hidden');

        if (clipErr || !clip) { showCardDetailError(); return; }

        // 自分のクリップ以外は表示しない（RLS でも弾かれるはずだが念のため）
        if (currentUser && clip.user_id && clip.user_id !== currentUser.id) {
            showCardDetailError();
            return;
        }

        currentClip = clip;
        renderClipBasics(clip);

        // 2. 元カードを Collection 側のテーブルから取得
        if (clip.original_card_id) {
            const idNum = parseInt(clip.original_card_id, 10);
            if (!isNaN(idNum)) {
                const { data: card, error: cardErr } = await supabaseClient
                    .from('cards')
                    .select('*')
                    .eq('id', idNum)
                    .maybeSingle();
                if (!cardErr && card) renderSourceCard(card);
            }
        }
    }

    function resetCardDetailUI() {
        document.getElementById('card-detail-error').classList.add('hidden');
        document.getElementById('card-detail-loading').classList.add('hidden');
        document.getElementById('card-detail-title').textContent = '';
        document.getElementById('card-detail-image').src = '';
        document.getElementById('card-detail-image').alt = '';
        document.getElementById('card-detail-area').textContent = '';
        document.getElementById('card-detail-recommender').textContent = '';
        document.getElementById('card-detail-divider').classList.add('hidden');
        document.getElementById('card-detail-description').textContent = '';
        document.getElementById('card-detail-list-name').textContent = '';
        document.getElementById('card-detail-clip-date').textContent = '';
        document.getElementById('card-detail-bizinfo').classList.add('hidden');
        document.getElementById('card-detail-bizinfo-list').innerHTML = '';
        document.getElementById('card-detail-map-wrap').classList.add('hidden');
        document.getElementById('card-detail-map-iframe').src = '';
    }

    function showCardDetailError() {
        document.getElementById('card-detail-error').classList.remove('hidden');
    }

    // Supabase の clip だけで描画できる部分（タイトル・画像・リスト名・日付・コレクションリンク）
    function renderClipBasics(clip) {
        document.getElementById('card-detail-title').textContent = clip.title || '';
        document.getElementById('card-detail-image').src = clip.image_url || '';
        document.getElementById('card-detail-image').alt = clip.title || '';
        document.getElementById('card-detail-list-name').textContent = clip.lists?.name || 'リスト';

        const created = clip.created_at ? new Date(clip.created_at) : null;
        document.getElementById('card-detail-clip-date').textContent = created
            ? `${created.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}にクリップ`
            : '';

        const sourceLink = document.getElementById('card-detail-open-source');
        if (clip.original_card_id) {
            sourceLink.href = `${COLLECTION_BASE_URL}?card=${encodeURIComponent(clip.original_card_id)}`;
            sourceLink.classList.remove('opacity-50', 'pointer-events-none');
        } else {
            sourceLink.href = COLLECTION_BASE_URL;
            sourceLink.classList.add('opacity-50', 'pointer-events-none');
        }
    }

    // 元カード（cards テーブル）の情報で詳細をリッチ化
    function renderSourceCard(card) {
        const areaEl = document.getElementById('card-detail-area');
        const recEl = document.getElementById('card-detail-recommender');
        const divider = document.getElementById('card-detail-divider');

        if (card.area) areaEl.textContent = `📍 ${card.area}`;
        if (card.recommended_by) {
            recEl.textContent = `by ${card.recommended_by}`;
            if (card.area) divider.classList.remove('hidden');
        }

        if (card.description) {
            document.getElementById('card-detail-description').textContent = card.description;
        }

        // 元カードに画像があれば、クリップのキャッシュより新しい可能性が高いのでそちらを採用
        if (card.image_url) {
            document.getElementById('card-detail-image').src = card.image_url;
        }

        // 店舗情報
        renderBusinessInfo(card);

        // 地図（lat/lng があれば iframe で埋め込む）
        const lat = card.lat || card.latitude;
        const lng = card.lng || card.longitude;
        if (lat && lng) {
            const wrap = document.getElementById('card-detail-map-wrap');
            const iframe = document.getElementById('card-detail-map-iframe');
            iframe.src = `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
            wrap.classList.remove('hidden');
        }
    }

    // ── 店舗情報パネル ──────────────────────────────────
    const CLOSED_DAY_LABELS_JA = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
    const CLOSED_DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    function formatClosedDays(raw) {
        if (!raw) return '';
        const set = new Set(String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
        if (!set.size) return '';
        const ordered = CLOSED_DAY_ORDER.filter(c => set.has(c));
        if (ordered.length === 7) return '毎日定休';
        return '定休日：' + ordered.map(c => CLOSED_DAY_LABELS_JA[c] || c).join('・');
    }

    function humanizeOpeningHours(raw) {
        if (!raw) return '';
        const dayMap = { Mo: '月', Tu: '火', We: '水', Th: '木', Fr: '金', Sa: '土', Su: '日' };
        let s = raw;
        Object.keys(dayMap).forEach(k => { s = s.replace(new RegExp(k, 'g'), dayMap[k]); });
        return s;
    }

    function renderBusinessInfo(card) {
        const rows = [];
        if (card.address) {
            rows.push(`
                <div class="flex items-start gap-2 text-gray-700">
                    <span class="flex-shrink-0 w-5 text-center">📍</span>
                    <span class="leading-snug">${escapeHtml(card.address)}</span>
                </div>`);
        }
        if (card.opening_hours) {
            const hours = humanizeOpeningHours(card.opening_hours);
            rows.push(`
                <div class="flex items-start gap-2 text-gray-700">
                    <span class="flex-shrink-0 w-5 text-center">⏰</span>
                    <span class="leading-snug whitespace-pre-line">${escapeHtml(hours)}</span>
                </div>`);
        }
        const closed = formatClosedDays(card.closed_days);
        if (closed) {
            rows.push(`
                <div class="flex items-start gap-2 text-gray-700">
                    <span class="flex-shrink-0 w-5 text-center">🚫</span>
                    <span class="leading-snug">${escapeHtml(closed)}</span>
                </div>`);
        }
        if (card.phone) {
            const tel = card.phone.replace(/[^\d+]/g, '');
            rows.push(`
                <a href="tel:${escapeAttr(tel)}" class="flex items-start gap-2 text-ciel-500 hover:text-ciel-400">
                    <span class="flex-shrink-0 w-5 text-center">📞</span>
                    <span class="leading-snug">${escapeHtml(card.phone)}</span>
                </a>`);
        }
        if (card.website) {
            let display = card.website;
            try { display = new URL(card.website).hostname.replace(/^www\./, ''); } catch (_) { }
            rows.push(`
                <a href="${escapeAttr(card.website)}" target="_blank" rel="noopener noreferrer" class="flex items-start gap-2 text-ciel-500 hover:text-ciel-400">
                    <span class="flex-shrink-0 w-5 text-center">🌐</span>
                    <span class="leading-snug break-all">${escapeHtml(display)}</span>
                </a>`);
        }

        const wrap = document.getElementById('card-detail-bizinfo');
        const list = document.getElementById('card-detail-bizinfo-list');
        if (!rows.length) {
            wrap.classList.add('hidden');
            list.innerHTML = '';
            return;
        }
        list.innerHTML = rows.join('');
        wrap.classList.remove('hidden');
    }

    // 戻るボタン：元のリスト詳細に戻す（list_id が分からなければマイページ）
    document.getElementById('card-detail-back-btn').addEventListener('click', () => {
        if (currentClip && currentClip.list_id) {
            window.location.hash = `#list?id=${currentClip.list_id}`;
        } else {
            window.location.hash = '#mypage';
        }
    });

    // 削除ボタン
    document.getElementById('card-detail-remove-btn').addEventListener('click', async () => {
        if (!currentClip) return;
        if (!confirm(`「${currentClip.title}」をリストから削除しますか？`)) return;

        const btn = document.getElementById('card-detail-remove-btn');
        btn.disabled = true;
        btn.textContent = '削除中...';

        const { error } = await supabaseClient
            .from('collected_cards')
            .delete()
            .eq('id', currentClip.id);

        if (error) {
            alert('削除に失敗しました: ' + error.message);
            btn.disabled = false;
            btn.textContent = '削除';
            return;
        }

        // 元のリスト詳細に戻す
        const targetListId = currentClip.list_id;
        currentClip = null;
        if (targetListId) {
            window.location.hash = `#list?id=${targetListId}`;
        } else {
            window.location.hash = '#mypage';
        }
    });

    // === Navigation / Hash Logic ===
    window.addEventListener('hashchange', handleRoute);
    logoBtn.addEventListener('click', () => { window.location.hash = currentUser ? '#mypage' : '#login'; });
    navLoginBtn.addEventListener('click', () => { window.location.hash = '#login'; });

    // Initialize: チェックセッション
    checkSession();
});
