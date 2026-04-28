/**
 * machica Admin - Supabase Wrapper
 * Replaces IndexedDB with Supabase Database
 */

const STORES = ['cards', 'areas', 'categories', 'settings'];

const machicaDB = {
    /**
     * 繝・・繧ｿ縺ｮ荳隕ｧ蜿門ｾ・     */
    async getAll(storeName) {
        if (!STORES.includes(storeName)) throw new Error('Invalid store: ' + storeName);
        const { data, error } = await supabaseClient.from(storeName).select('*');
        if (error) {
            console.error('Supabase getAll Error:', error);
            return [];
        }
        return data || [];
    },

    /**
     * 蜊倅ｸ繝・・繧ｿ縺ｮ蜿門ｾ・     */
    async get(storeName, id) {
        if (!STORES.includes(storeName)) throw new Error('Invalid store: ' + storeName);
        const { data, error } = await supabaseClient.from(storeName).select('*').eq('id', id).single();
        if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
            console.error('Supabase get Error:', error);
        }
        return data || null;
    },

    async uploadImageIfBase64(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;
        
        try {
            // Convert Base64 to Blob
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            
            // Generate unique filename
            const ext = blob.type.split('/')[1] || 'jpeg';
            const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
            const fileObj = new File([blob], filename, { type: blob.type });
            
            // Upload to Supabase
            const { data, error } = await supabaseClient.storage.from('images').upload(filename, fileObj, {
                cacheControl: '3600',
                upsert: false
            });
            
            if (error) {
                console.error('Storage Upload Error Detail:', error);
                throw error;
            }
            
            // Get public URL
            const { data: publicData } = supabaseClient.storage.from('images').getPublicUrl(filename);
            return publicData.publicUrl;
        } catch (e) {
            console.error('Image upload failed:', e);
            alert('逕ｻ蜒上・繧｢繝・・繝ｭ繝ｼ繝峨↓螟ｱ謨励＠縺ｾ縺励◆: ' + (e.message || JSON.stringify(e)));
            throw e; // 繧ｨ繝ｩ繝ｼ繧呈兜縺偵※蜈ｨ菴薙・菫晏ｭ倥ｒ荳ｭ豁｢縺吶ｋ
        }
    },

    async processCardImages(card) {
        if (card.image_url) card.image_url = await this.uploadImageIfBase64(card.image_url);
        if (card.image_url_back) card.image_url_back = await this.uploadImageIfBase64(card.image_url_back);
        if (card.gallery && Array.isArray(card.gallery)) {
            for (let i = 0; i < card.gallery.length; i++) {
                card.gallery[i] = await this.uploadImageIfBase64(card.gallery[i]);
            }
        }
    },

    /**
     * 繝・・繧ｿ縺ｮ霑ｽ蜉繝ｻ譖ｴ譁ｰ・亥腰荳縺ｾ縺溘・驟榊・・・     */
    async put(storeName, data) {
        if (!STORES.includes(storeName)) throw new Error('Invalid store: ' + storeName);
        
        // Ensure array for upsert
        const records = Array.isArray(data) ? data : [data];
        
        // Process images if storing cards
        if (storeName === 'cards') {
            for (const record of records) {
                await this.processCardImages(record);
            }
        }
        
        const { error } = await supabaseClient.from(storeName).upsert(records);
        if (error) {
            console.error('Supabase put Error:', error);
            throw error;
        }
    },

    /**
     * 繝・・繧ｿ縺ｮ蜑企勁
     */
    async delete(storeName, id) {
        if (!STORES.includes(storeName)) throw new Error('Invalid store: ' + storeName);
        const { error } = await supabaseClient.from(storeName).delete().eq('id', id);
        if (error) {
            console.error('Supabase delete Error:', error);
            throw error;
        }
    }
};

