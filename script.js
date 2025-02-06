let globalFollowers = [];
let globalFollowing = [];

async function analyzeConnections() {
    const username = document.getElementById('username').value.trim();
    const pat = document.getElementById('pat').value.trim();
    
    if (!username || !pat) {
        showError('Please enter both username and PAT token');
        return;
    }

    showLoading(true);
    showError('');
    hideResults();

    try {
        const headers = {
            'Authorization': `token ${pat}`,
            'Accept': 'application/vnd.github.v3+json'
        };

        // First verify the token by checking user details
        try {
            const userResponse = await fetch(`https://api.github.com/user`, { headers });
            if (!userResponse.ok) {
                throw new Error('Invalid PAT token or insufficient permissions');
            }
        } catch (error) {
            throw new Error('Failed to validate PAT token. Please check your token.');
        }

        // Fetch followers and following lists
        const [followers, following] = await Promise.all([
            fetchGitHubData(`https://api.github.com/users/${username}/followers?per_page=100`, headers),
            fetchGitHubData(`https://api.github.com/users/${username}/following?per_page=100`, headers)
        ]);

        // Store the data globally
        globalFollowers = followers;
        globalFollowing = following;

        // Process the data
        const followersSet = new Set(followers.map(user => user.login));
        const followingSet = new Set(following.map(user => user.login));
        
        // Find mutual connections
        const mutualConnections = followers.filter(user => followingSet.has(user.login));
        const followersOnly = followers.filter(user => !followingSet.has(user.login));
        const followingOnly = following.filter(user => !followersSet.has(user.login));

        // Update UI
        updateStats(followers.length, following.length, mutualConnections.length);
        updateLists(mutualConnections, followersOnly, followingOnly);
        showResults();
        initializeListActions(); // Add this line
        
    } catch (error) {
        showError(error.message || 'An unexpected error occurred');
    } finally {
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

function updateStats(followers, following, mutual) {
    document.getElementById('followers-count').textContent = followers;
    document.getElementById('following-count').textContent = following;
    document.getElementById('mutual-count').textContent = mutual;
}

function updateLists(mutual, followersOnly, followingOnly) {
    updateList('mutual-list', mutual);
    updateList('followers-only-list', followersOnly);
    updateList('following-only-list', followingOnly);
}

function updateList(elementId, users) {
    const list = document.getElementById(elementId);
    list.innerHTML = users
        .map(user => `<li class="user-item">
            <input type="checkbox" data-username="${user.login}">
            <a href="${user.html_url}" target="_blank">
                <img src="${user.avatar_url}" alt="${user.login}" width="25" height="25">
                ${user.login}
            </a>
            <span class="action-status"></span>
        </li>`)
        .join('');
}

// Add new functions for follow/unfollow functionality
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

function initializeListActions() {
    // Handle select all checkboxes
    document.querySelectorAll('.select-all').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const listId = e.target.dataset.list;
            const listCheckboxes = document.querySelectorAll(`#${listId} input[type="checkbox"]`);
            listCheckboxes.forEach(cb => cb.checked = e.target.checked);
        });
    });

    // Handle follow/unfollow buttons
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
                    if (e.target.classList.contains('follow-selected')) {
                        await followUser(checkbox.dataset.username, headers);
                        updateFeedbackStatus(userItem, true, 'Following');
                    } else {
                        await unfollowUser(checkbox.dataset.username, headers);
                        updateFeedbackStatus(userItem, true, 'Unfollowed');
                    }
                } catch (error) {
                    updateFeedbackStatus(userItem, false, 'Failed');
                } finally {
                    userItem.classList.remove('processing');
                    checkbox.checked = false;
                }
                
                // Add delay between requests
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        });
    });
}

// ...existing code...

async function getRecommendedUnfollows() {
    const recommendedUnfollows = [];
    const totalUsers = globalFollowing.length;
    let processedUsers = 0;
    
    updateLoadingMessage(`Starting analysis of ${totalUsers} users...`);
    
    for (const user of globalFollowing) {
        try {
            // Get user's detailed information
            const url = `https://api.github.com/users/${user.login}`;
            console.log(`Fetching data for ${user.login} from: ${url}`);
            
            const headers = {
                'Authorization': `token ${document.getElementById('pat').value.trim()}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            const response = await fetch(url, { headers });
            if (!response.ok) {
                throw new Error(`Failed to fetch user data: ${response.status}`);
            }
            
            const userDetails = await response.json();
            
            // Debug information
            console.log(`${user.login}:`, {
                followers: userDetails.followers,
                following: userDetails.following,
                ratio: userDetails.following / (userDetails.followers || 1)
            });

            // Simpler ratio check
            if (userDetails.followers === 0 || userDetails.following / userDetails.followers >= 2) {
                console.log(`✓ Found match: ${user.login}`);
                recommendedUnfollows.push({
                    ...user,
                    followers: userDetails.followers,
                    following: userDetails.following,
                    ratio: userDetails.following / (userDetails.followers || 1)
                });
            }

            processedUsers++;
            updateLoadingMessage(`Analyzed ${processedUsers}/${totalUsers} users...`);
            
        } catch (error) {
            console.error(`Error analyzing ${user.login}:`, error);
            processedUsers++;
        }
        
        // Smaller delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('Analysis Results:', {
        totalProcessed: processedUsers,
        recommendedCount: recommendedUnfollows.length,
        recommendations: recommendedUnfollows
    });
    
    return recommendedUnfollows;
}

async function showRecommendedUnfollows() {
    if (!globalFollowing.length) {
        showError('Please analyze your connections first');
        return;
    }

    showLoading(true);
    showError('');
    try {
        const recommendedUnfollows = await getRecommendedUnfollows();
        const list = document.getElementById('recommended-list');
        
        if (recommendedUnfollows.length === 0) {
            list.innerHTML = `
                <li class="no-results">
                    <div>No recommended unfollows found</div>
                    <small>Criteria: Users who follow ≥ 2x more people than follow them</small>
                    <small>Or users with 0 followers</small>
                </li>`;
        } else {
            list.innerHTML = recommendedUnfollows
                .map(user => `<li class="user-item">
                    <input type="checkbox" data-username="${user.login}">
                    <a href="${user.html_url}" target="_blank">
                        <img src="${user.avatar_url}" alt="${user.login}" width="25" height="25">
                        ${user.login}
                    </a>
                    <span class="user-stats">
                        Following/Followers: ${user.following}/${user.followers}
                        (Ratio: ${user.ratio.toFixed(1)})
                    </span>
                    <span class="action-status"></span>
                </li>`)
                .join('');
        }
        
        document.getElementById('recommended-unfollows').classList.remove('hidden');
        initializeListActions();
    } catch (error) {
        console.error('Recommendation error:', error);
        showError('Error: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// ...existing code...
async function getRecommendedFollowers(username, headers) {
    const recommendedFollowers = [];
    let processedUsers = 0;
    let potentialFollows = [];

    updateLoadingMessage(`Fetching potential users to follow...`);

    try {
        // Fetch users that the current user is following
        potentialFollows = await fetchGitHubData(`https://api.github.com/users/${username}/following?per_page=100`, headers);

        const totalPotentialFollows = potentialFollows.length;
        updateLoadingMessage(`Analyzing ${totalPotentialFollows} potential follows...`);

        // Create a set of your followers for quick lookup
        const myFollowersSet = new Set(globalFollowers.map(f => f.login));
        const myFollowingSet = new Set(globalFollowing.map(f => f.login));

        for (const potentialFollow of potentialFollows) {
            try {
                const url = `https://api.github.com/users/${potentialFollow.login}`;
                console.log(`Fetching data for ${potentialFollow.login} from: ${url}`);

                const response = await fetch(url, { headers });
                if (!response.ok) {
                    console.warn(`Failed to fetch user data: ${response.status}`);
                    continue;
                }

                const userDetails = await response.json();

                // Skip if user is already a follower OR is already being followed
                if (myFollowersSet.has(potentialFollow.login) || myFollowingSet.has(potentialFollow.login)) {
                    console.log(`Skipping existing connection: ${potentialFollow.login}`);
                    continue;
                }

                // Recommendation criteria: Following >= Followers
                if (userDetails.following >= userDetails.followers) {
                    console.log(`✓ Found match: ${userDetails.login}`);
                    recommendedFollowers.push({
                        ...potentialFollow,
                        followers: userDetails.followers,
                        following: userDetails.following
                    });
                }

                processedUsers++;
                updateLoadingMessage(`Analyzed ${processedUsers}/${totalPotentialFollows} users...`);

                if (recommendedFollowers.length >= 20) {
                    console.log('Reached maximum recommendations, stopping analysis.');
                    break;
                }

            } catch (error) {
                console.error(`Error analyzing ${potentialFollow.login}:`, error);
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log('Analysis Results:', {
            totalProcessed: processedUsers,
            recommendedCount: recommendedFollowers.length,
            recommendations: recommendedFollowers
        });

        return recommendedFollowers;

    } catch (error) {
        showError('Error fetching recommended followers: ' + error.message);
        return [];
    }
}

async function showRecommendedFollowers() {
    showLoading(true);
    showError('');

    try {
        const username = document.getElementById('username').value.trim();
        const pat = document.getElementById('pat').value.trim();

        const headers = {
            'Authorization': `token ${pat}`,
            'Accept': 'application/vnd.github.v3+json'
        };

        const recommendedFollowers = await getRecommendedFollowers(username, headers);
        const list = document.getElementById('recommended-followers-list');

        if (recommendedFollowers.length === 0) {
            list.innerHTML = `<li class="no-results">No recommended followers found.</li>`;
        } else {
            list.innerHTML = recommendedFollowers.map(user => `
                <li class="user-item">
                    <input type="checkbox" data-username="${user.login}">
                    <a href="${user.html_url}" target="_blank">
                        <img src="${user.avatar_url}" alt="${user.login}" width="25" height="25">
                        ${user.login}
                    </a>
                    <span class="user-stats">
                        Following: ${user.following} | Followers: ${user.followers}
                    </span>
                    <span class="action-status"></span>
                </li>
            `).join('');
        }

        document.getElementById('recommended-followers').classList.remove('hidden');
        initializeListActions();
    } catch (error) {
        showError('Error: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// ...rest of existing code...

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
    statusElement.innerHTML = isSuccess ? 
        `<i class="fas fa-check-circle"></i> ${message}` :
        `<i class="fas fa-times-circle"></i> ${message}`;
    
    statusElement.className = 'action-status';
    statusElement.classList.add(isSuccess ? 'success' : 'error');
    statusElement.classList.add('show');

    // Remove the status after 5 seconds
    setTimeout(() => {
        statusElement.classList.remove('show');
    }, 5000);
}
