import React, {useState} from "react";
import {type AppUser, useAuth} from "./hooks/useAuth";
import ProfileModal from "./ProfileModal.tsx";

type HeaderPageProps = {
    user: AppUser;
};

function Header({user}: HeaderPageProps) {

    const {logout} = useAuth();
    const [showProfile, setShowProfile] = useState(false);

    return (
        <header>
            <div className="header-container">
                <div className="header-img">
                    <img src="/logo.svg" alt="Logo" className=""/>
                </div>
                <div className="header-buttons">
                    <button
                        className="button-small button-border button-colorless boldFont"
                        type="button"
                        onClick={() => setShowProfile(true)}
                    >Min profil
                    </button>
                    <button
                        className="button-small button-border button-black boldFont"
                        type="button"
                        onClick={logout}
                    >Logg ut
                    </button>
                </div>
            </div>
            <div>
                {showProfile && (
                    <ProfileModal
                        uid={user.uid}
                        role={user.role}
                        email={user.email}
                        displayName={user.displayName}
                        onClose={() => setShowProfile(false)}
                    />
                )}
            </div>
        </header>
    );
}

export default Header;