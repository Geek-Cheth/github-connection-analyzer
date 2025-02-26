(function() {
    let globalFollowing = [];
    let targetUserFollowing = [];
    let globalFollowers = [];

    function updateProgress(percent) {
        const progressBar = document.getElementById('progress');
        
        if (progressBar) {
            if (percent > 0) {
                progressBar.style.display = 'block';
                progressBar.style.width = percent + '%';
            } else {
                progressBar.style.display = 'none';
            }
        }
    }

    function startProgress() {
        updateProgress(0);
        document.getElementById('progress').style.display = 'block';
        document.getElementById('progress').style.width = '5%';
        return updateProgress;
    }

    async function analyzeConnections() {
        const username = document.getElementById('username').value.trim();
        const pat = document.getElementById('pat').value.trim();
        const targetUsername = document.getElementById('targetUsername').value.trim();
        
        if (!username || !pat || !targetUsername) {
            showError('Please enter both your credentials and target username');
            return;
        }

        showLoading(true);
        showError('');
        const updateProgressStatus = startProgress();
        hideResults();

        try {
            const headers = {
                'Authorization': `token ${pat}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            // First verify the token
            try {
                updateProgressStatus(10);
                const userResponse = await fetch(`https://api.github.com/user`, { headers });
                if (!userResponse.ok) {
                    throw new Error('Invalid PAT token or insufficient permissions');
                }
            } catch (error) {
                throw new Error('Failed to validate PAT token. Please check your token.');
            }

            // Fetch both users' following lists
            updateLoadingMessage('Fetching user data...');
            updateProgressStatus(30);
            const [userFollowing, targetFollowing, followers] = await Promise.all([
                fetchGitHubData(`https://api.github.com/users/${username}/following?per_page=100`, headers),
                fetchGitHubData(`https://api.github.com/users/${targetUsername}/following?per_page=100`, headers),
                fetchGitHubData(`https://api.github.com/users/${username}/followers?per_page=100`, headers)
            ]);

            updateProgressStatus(70);
            // Store the data globally
            globalFollowing = userFollowing;
            targetUserFollowing = targetFollowing;
            globalFollowers = followers;

            // Process the data
            const userFollowingSet = new Set(userFollowing.map(user => user.login));
            
            // Split target's following into already following and not following
            updateProgressStatus(90);
            const alreadyFollowing = targetFollowing.filter(user => userFollowingSet.has(user.login));
            const notFollowing = targetFollowing.filter(user => !userFollowingSet.has(user.login));

            // Update UI
            updateStats(targetFollowing.length, alreadyFollowing.length, notFollowing.length);
            updateLists(alreadyFollowing, notFollowing);
            setupFiltering();
            showResults();
            updateProgressStatus(100);
            initializeListActions();
            
        } catch (error) {
            showError(error.message || 'An unexpected error occurred');
        } finally {
            setTimeout(() => updateProgress(0), 300);
            showLoading(false);
        }
    }

    async function fetchGitHubData(url, headers) {
        let allData = [];
        let currentUrl = url;

        while (currentUrl) {
            const response = await fetch(currentUrl, { headers });
            
            if (response.status === 401) {
                throw new Error('Invalid authentication token. Please check your PAT token.');
            }
            
            if (response.status === 403) {
                throw new Error('API rate limit exceeded or insufficient permissions.');
            }
            
            if (response.status === 404) {
                throw new Error('User not found. Please check the username.');
            }
            
            if (!response.ok) {
                throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            allData = allData.concat(data);

            // Check for pagination
            const linkHeader = response.headers.get('Link');
            currentUrl = null;
            if (linkHeader) {
                const nextLink = linkHeader.split(',').find(link => link.includes('rel="next"'));
                if (nextLink) {
                    currentUrl = nextLink.split(';')[0].trim().slice(1, -1);
                }
            }
        }

        return allData;
    }

    function updateStats(targetFollowing, alreadyFollowing, notFollowing) {
        document.getElementById('target-following-count').textContent = targetFollowing;
        document.getElementById('already-following-count').textContent = alreadyFollowing;
        document.getElementById('not-following-count').textContent = notFollowing;
    }

    function updateLists(alreadyFollowing, notFollowing) {
        updateList('already-following-list', alreadyFollowing);
        updateList('not-following-list', notFollowing);
    }

    async function fetchUserDetails(user, headers) {
        try {
            const response = await fetch(`https://api.github.com/users/${user.login}`, { headers });
            if (!response.ok) return user;
            return await response.json();
        } catch (error) {
            console.error(`Error fetching details for ${user.login}:`, error);
            return user;
        }
    }

    function updateList(elementId, users) {
        const list = document.getElementById(elementId);
        list.innerHTML = users.length ? users
            .map(user => `<li class="user-item">
                <div class="user-info">
                    <input type="checkbox" data-username="${user.login}">
                    <a href="${user.html_url}" target="_blank">
                        <img src="${user.avatar_url}" alt="${user.login}" width="25" height="25">
                    </a>
                    <div class="user-details">
                        <span class="user-name">${user.login}</span>
                        <span class="user-bio">${user.bio || ''}</span>
                    </div>
                </div>
                <span class="user-stats">
                    ${user.public_repos ? `Repos: ${user.public_repos} | ` : ''}
                    ${user.followers ? `Followers: ${user.followers}` : ''}
                </span>
                <span class="action-status"></span>
            </li>`)
            .join('') : '<li class="no-results">No users found</li>';
    }

    async function followUser(username, headers) {
        const response = await fetch(`https://api.github.com/user/following/${username}`, {
            method: 'PUT',
            headers
        });
        if (!response.ok) throw new Error('Failed to follow user');
    }

    async function unfollowUser(username, headers) {
        const response = await fetch(`https://api.github.com/user/following/${username}`, {
            method: 'DELETE',
            headers
        });
        if (!response.ok) throw new Error('Failed to unfollow user');
    }

    function setupFiltering() {
        const filterInput = document.getElementById('filterInput');
        const sortSelect = document.getElementById('sortSelect');
        const hideFollowingMe = document.getElementById('hideFollowingMe');

        const applyFilters = () => {
            const filterText = filterInput.value.toLowerCase();
            const sortBy = sortSelect.value;
            const hideFollowers = hideFollowingMe.checked;
            const followersSet = new Set(globalFollowers.map(user => user.login));
            const userFollowingSet = new Set(globalFollowing.map(user => user.login));
            const filteredTargetFollowing = targetUserFollowing.filter(user => 
                user.login.toLowerCase().includes(filterText)
            );

            // Sort users
            filteredTargetFollowing.sort((a, b) => {
                switch (sortBy) {
                    case 'name':
                        return a.login.localeCompare(b.login);
                    case 'followers':
                        return (b.followers || 0) - (a.followers || 0);
                    case 'repos':
                        return (b.public_repos || 0) - (a.public_repos || 0);
                    default:
                        return 0;
                }
            });

            let filteredNotFollowing = filteredTargetFollowing.filter(user => !userFollowingSet.has(user.login));
            if (hideFollowers) {
                filteredNotFollowing = filteredNotFollowing.filter(user => !followersSet.has(user.login));
            }

            // Split and update lists
            const alreadyFollowing = filteredTargetFollowing.filter(user => userFollowingSet.has(user.login));
            const notFollowing = filteredNotFollowing;
            updateLists(alreadyFollowing, notFollowing);
            initializeListActions();
        };

        filterInput.addEventListener('input', applyFilters);
        sortSelect.addEventListener('change', applyFilters);
        hideFollowingMe.addEventListener('change', applyFilters);
    }

    function initializeListActions() {
        document.querySelectorAll('.select-all').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const listId = e.target.dataset.list;
                const listCheckboxes = document.querySelectorAll(`#${listId} input[type="checkbox"]`);
                listCheckboxes.forEach(cb => cb.checked = e.target.checked);
            });
        });

        document.querySelectorAll('.follow-selected, .unfollow-selected').forEach(button => {
            button.addEventListener('click', async (e) => {
                const listId = e.target.dataset.list;
                const selectedUsers = document.querySelectorAll(`#${listId} input[type="checkbox"]:checked`);
                const headers = {
                    'Authorization': `token ${document.getElementById('pat').value.trim()}`,
                    'Accept': 'application/vnd.github.v3+json'
                };

                for (const checkbox of selectedUsers) {
                    const userItem = checkbox.closest('.user-item');
                    userItem.classList.add('processing');
                    
                    try {
                        const isFollowing = button.classList.contains('follow-selected');
                        updateFeedbackStatus(userItem, true, isFollowing ? 'Following...' : 'Unfollowing...');
                        if (button.classList.contains('follow-selected')) {
                            updateFeedbackStatus(userItem, true, 'Following');
                            await followUser(checkbox.dataset.username, headers);
                        } else {
                            await unfollowUser(checkbox.dataset.username, headers);
                            userItem.classList.add('unfollowed');
                            updateFeedbackStatus(userItem, true, 'Unfollowed');
                        }
                    } catch (error) {
                        updateFeedbackStatus(userItem, false, 'Failed');
                    } finally {
                        userItem.classList.remove('processing');
                        checkbox.checked = false;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            });
        });
    }

    function updateLoadingMessage(message) {
        const loadingElement = document.getElementById('loading');
        loadingElement.textContent = message;
    }

    function showLoading(show) {
        document.getElementById('loading').classList.toggle('hidden', !show);
    }

    function showError(message) {
        const error = document.getElementById('error');
        error.textContent = message;
        error.classList.toggle('hidden', !message);
    }

    function showResults() {
        document.getElementById('results').classList.remove('hidden');
    }

    function hideResults() {
        document.getElementById('results').classList.add('hidden');
    }

    function updateFeedbackStatus(element, isSuccess, message) {
        const statusElement = element.querySelector('.action-status');
        statusElement.className = 'action-status';
        statusElement.innerHTML = isSuccess ? 
            `<i class="fas fa-check"></i> ${message}` :
            `<i class="fas fa-times"></i> ${message}`;
        
        void statusElement.offsetHeight; // Force repaint
        statusElement.classList.add(isSuccess ? 'success' : 'error');
        statusElement.classList.add('show');

        setTimeout(() => {
            statusElement.classList.remove('show');
        }, 3000);
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('analyzeButton').addEventListener('click', analyzeConnections);
    });
})();